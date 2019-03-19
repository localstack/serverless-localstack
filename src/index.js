'use strict';
const AWS = require('aws-sdk');
const fs = require('fs');
const util = require('util');
const exec = util.promisify(require('child_process').exec);

// Default stage used by Serverless
const defaultStage = 'dev';


class LocalstackPlugin {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;

    this.readConfig();

    if (!this.isActive()) {
      return;
    }

    this.commands = {
      deploy: {lifecycleEvents: ['resources']}
    };
    this.hooks = {
      'before:deploy:resources': this.beforeDeploy.bind(this)
    };
    this.AWS_SERVICES = {
      'apigateway': 4567,
      'cloudformation': 4581,
      'cloudwatch': 4582,
      'lambda': 4574,
      'dynamodb': 4569,
      'kinesis': 4568,
      'route53': 4580,
      'firehose': 4573,
      'stepfunctions': 4585,
      'es': 4578,
      's3': 4572,
      'ses': 4579,
      'sns': 4575,
      'sqs': 4576,
      'sts': 4592,
      'iam': 4593
    };

    // Intercept Provider requests
    this.awsProvider = this.serverless.getProvider('aws');
    this.awsProviderRequest = this.awsProvider.request.bind(this.awsProvider);
    this.awsProvider.request = this.interceptRequest.bind(this);

    // Patch plugin methods
    this.skipIfMountLambda('Package', 'packageService')
    function compileFunction(functionName) {
      if (!this.shouldMountCode()) {
        return Promise.resolve();
      }
      const functionObject = this.serverless.service.getFunction(functionName);
      functionObject.package = functionObject.package || {};
      functionObject.package.artifact = __filename;
      return compileFunction._functionOriginal(functionName).then(() => {
       const resources = this.serverless.service.provider.compiledCloudFormationTemplate.Resources;
       Object.keys(resources).forEach(id => {
         const res = resources[id];
         if (res.Type === 'AWS::Lambda::Function') {
           res.Properties.Code.S3Bucket = '__local__';
           res.Properties.Code.S3Key = process.cwd();
           if (process.env.LAMBDA_MOUNT_CWD) {
             // Allow users to define a custom working directory for Lambda mounts.
             // For example, when deploying a Serverless app in a Linux VM (that runs Docker) on a
             // Windows host where the "-v <local_dir>:<cont_dir>" flag to "docker run" requires us
             // to specify a "local_dir" relative to the Windows host file system that is mounted
             // into the VM (e.g., "c:/users/guest/...").
             res.Properties.Code.S3Key = process.env.LAMBDA_MOUNT_CWD;
           }
         }
       })
      });
    }
    this.skipIfMountLambda('AwsCompileFunctions', 'compileFunction', compileFunction);
    this.skipIfMountLambda('AwsDeploy', 'extendedValidate');
    this.skipIfMountLambda('AwsDeploy', 'uploadFunctionsAndLayers');
  }

  beforeDeploy() {
    if (this.pluginEnabled) {
      return;
    }
    this.pluginEnabled = true;
    return this.enablePlugin();
  }

  async enablePlugin() {
    // reconfigure AWS endpoints based on current stage variables
    this.getStageVariable();
    await this.startLocalStack();
    return this.reconfigureAWS();
  }

  async startLocalStack() {
    if (!this.config.autostart) {
      return;
    }
    const stdout = (await exec('docker ps')).stdout;
    const exists = stdout.split('\n').filter((line) => line.indexOf('localstack/localstack') >= 0);
    if (!exists.length) {
      this.log('Starting LocalStack in Docker. This can take a while.');
      const options = {env: {LAMBDA_EXECUTOR: 'docker', DEBUG: '1', DOCKER_FLAGS: '-d'}};
      await exec('localstack infra start --docker', options);
      await exec('sleep 15');
    }
  }

  findPlugin(name) {
    return this.serverless.pluginManager.plugins.find(p => p.constructor.name === name);
  }

  skipIfMountLambda(pluginName, functionName, overrideFunction) {
    const plugin = this.findPlugin(pluginName);
    if (!plugin) {
      this.log('Warning: Unable to find plugin named: ' + pluginName)
      return
    }
    const functionOriginal = plugin[functionName].bind(plugin);

    function overrideFunctionDefault() {
      if (this.shouldMountCode()) {
        const fqn = pluginName + '.' + functionName;
        this.log('Skip plugin function ' + fqn + ' (lambda.mountCode flag is enabled)');
        return Promise.resolve();
      }
      return functionOriginal.apply(null, arguments);
    }
    overrideFunction = overrideFunction || overrideFunctionDefault;
    overrideFunction._functionOriginal = functionOriginal;
    plugin[functionName] = overrideFunction.bind(this);
  }

  readConfig() {
    this.config = (this.serverless.service.custom || {}).localstack || {};
    Object.assign(this.config, this.options);

    //Get the target deployment stage
    this.config.stage = "";
    this.config.options_stage = this.options.stage || undefined;

    //If the target stage is listed in config.stages use the serverless-localstack-plugin
    //To keep default behavior if config.stages is undefined, then use serverless-localstack-plugin
    this.endpoints = this.config.endpoints || {};
    this.endpointFile = this.config.endpointFile;
    if (this.endpointFile) {
      this.loadEndpointsFromDisk(this.endpointFile);
    }
  }

  isActive() {
    // Activate the plugin if either:
    //   (1) serverless is invoked with the default stage ("dev") and no `stages` config is provided; or
    //   (2) serverless is invoked with a --stage flag and this stage is included in the `stages` config
    const noStageUsed = this.config.stages === undefined && (this.options.stage || defaultStage) == defaultStage;
    const includedInStages = this.config.stages && this.config.stages.includes(this.options.stage);
    return noStageUsed || includedInStages;
  }

  getStageVariable() {
    this.debug("config.options_stage: " + this.config.options_stage);
    this.debug("serverless.service.custom.stage: " + this.serverless.service.custom.stage);
    this.debug("serverless.service.provider.stage: " + this.serverless.service.provider.stage);
    this.config.stage = this.config.options_stage || this.serverless.service.custom.stage || this.serverless.service.provider.stage;
    this.debug("config.stage: " + this.config.stage);
  }

  configureAWSCredentials() {
    process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || 'test';
    process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || 'test';
  }

  async createDeploymentBucket() {
    const bucketName = this.serverless.service.provider.deploymentBucket;
    if (!bucketName) {
      return;
    }
    const params = {};
    const buckets = (await this.awsProviderRequest('S3', 'listBuckets', params)).Buckets;
    const found = buckets.filter((b) => b.Name == bucketName);
    if (!found.length) {
      this.log('Creating deployment bucket ' + bucketName);
      await this.awsProviderRequest('S3', 'createBucket', {'Bucket': bucketName});
    }
  }

  async reconfigureAWS() {
    if(this.isActive()) {
      this.log('Using serverless-localstack');
      const host = this.config.host;
      const configChanges = {};

      // make sure we have AWS credentials configured
      this.configureAWSCredentials();

      // If a host has been configured, override each service
      if (host) {
        for (const service of Object.keys(this.AWS_SERVICES)) {
          const serviceLower = service.toLowerCase();
          const port = this.AWS_SERVICES[service];
          const url = `${host}:${port}`;

          this.debug(`Reconfiguring service ${service} to use ${url}`);
          configChanges[serviceLower] = { endpoint: url };

          if (serviceLower == 's3') {
            configChanges[serviceLower].s3ForcePathStyle = true;
          }
        }
      }

      // Override specific endpoints if specified
      if (this.endpoints) {
        for (const service of Object.keys(this.endpoints)) {
          const url = this.endpoints[service];
          const serviceLower = service.toLowerCase();

          this.debug(`Reconfiguring service ${service} to use ${url}`);
          configChanges[serviceLower] = configChanges[serviceLower] || {};
          configChanges[serviceLower].endpoint = url;
        }
      }

      // update SDK with overridden configs
      this.awsProvider.sdk.config.update(configChanges);

      // make sure the deployment bucket exists in the local environment
      await this.createDeploymentBucket();
    }
    else {
      this.endpoints = {}
      this.log("Skipping serverless-localstack:\ncustom.localstack.stages: " +
        JSON.stringify(this.config.stages) + "\nstage: " + this.config.stage
      )
    }
  }

  loadEndpointsFromDisk(endpointFile) {
    let endpointJson;

    this.debug('Loading endpointJson from ' + endpointFile);

    try {
      endpointJson = JSON.parse( fs.readFileSync(endpointFile) );
    } catch(err) {
      throw new ReferenceError(`Endpoint: "${this.endpointFile}" is invalid: ${err}`)
    }

    for (const key of Object.keys(endpointJson)) {
      this.debug('Intercepting service ' + key);
      this.endpoints[key] = endpointJson[key];
    }
  }

  log(msg) {
    this.serverless.cli.log.call(this.serverless.cli, msg);
  }

  debug(msg) {
    if (this.config.debug) {
      this.log(msg);
    }
  }

  shouldMountCode() {
    return (this.config.lambda || {}).mountCode
  }

  interceptRequest(service, method, params) {
    // Template validation is not supported in LocalStack
    if (method == "validateTemplate") {
      this.log('Skipping template validation: Unsupported in Localstack');
      return Promise.resolve('');
    }

    if (AWS.config[service.toLowerCase()]) {
      this.debug(`Using custom endpoint for ${service}: ${AWS.config[service.toLowerCase()].endpoint}`);

      if (AWS.config['s3'] && params.TemplateURL) {
        this.debug(`Overriding S3 templateUrl to ${AWS.config.s3.endpoint}`);
        params.TemplateURL = params.TemplateURL.replace(/https:\/\/s3.amazonaws.com/, AWS.config['s3'].endpoint);
      }
    }

    return this.awsProviderRequest(service, method, params);
  }
}

module.exports = LocalstackPlugin;
