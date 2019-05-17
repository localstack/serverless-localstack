'use strict';
const AWS = require('aws-sdk');
const fs = require('fs');
const {promisify} = require('es6-promisify');
const exec = promisify(require('child_process').exec);

// Default stage used by Serverless
const defaultStage = 'dev';
// Strings or other values considered to represent "true"
const trueValues = ['1', 'true', true];


class LocalstackPlugin {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;

    this.readConfig();

    if (!this.isActive()) {
      this.log("serverless-localstack plugin not activated. '"
        + (this.options.stage || defaultStage) + "' is not present in config custom.localstack.stages");
      return;
    }

    this.commands = {
      deploy: {lifecycleEvents: ['resources']}
    };
    this.hooks = {};
    // Define a before-hook for all event types
    for (let event in this.serverless.pluginManager.hooks) {
      if ((event.startsWith('before:') || event.startsWith('aws:common:validate')) && !this.hooks[event]) {
        this.hooks[event] = this.beforeEventHook.bind(this, event);
      }
    }

    this.awsServices = {
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
      'iam': 4593,
      'ssm': 4583
    };

    // Intercept Provider requests
    this.awsProvider = this.serverless.getProvider('aws');
    this.awsProviderRequest = this.awsProvider.request.bind(this.awsProvider);
    this.awsProvider.request = this.interceptRequest.bind(this);

    // Patch plugin methods
    this.skipIfMountLambda('Package', 'packageService')
    function compileFunction(functionName) {
      if (!this.shouldMountCode()) {
        return compileFunction._functionOriginal.apply(null, arguments);
      }
      const functionObject = this.serverless.service.getFunction(functionName);
      functionObject.package = functionObject.package || {};
      functionObject.package.artifact = __filename;
      return compileFunction._functionOriginal.apply(null, arguments).then(() => {
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
        });
      });
    }
    this.skipIfMountLambda('AwsCompileFunctions', 'compileFunction', compileFunction);
    this.skipIfMountLambda('AwsDeploy', 'extendedValidate');
    this.skipIfMountLambda('AwsDeploy', 'uploadFunctionsAndLayers');
  }

  beforeEventHook() {
    if (this.pluginEnabled) {
      return Promise.resolve();
    }
    this.pluginEnabled = true;
    return this.enablePlugin();
  }

  enablePlugin() {
    // reconfigure AWS endpoints based on current stage variables
    this.getStageVariable();
    return this.startLocalStack().then(
      () => {
          this.reconfigureAWS();
          this.patchServerlessSecrets();
          this.patchS3BucketLocationResponse();
      }
    );
  }

  findPlugin(name) {
    return this.serverless.pluginManager.plugins.find(p => p.constructor.name === name);
  }

  skipIfMountLambda(pluginName, functionName, overrideFunction) {
    const plugin = this.findPlugin(pluginName);
    if (!plugin) {
      this.log('Warning: Unable to find plugin named: ' + pluginName)
      return;
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
    //   (1) the serverless stage (explicitly defined or default stage "dev") is included in the `stages` config; or
    //   (2) serverless is invoked without a --stage flag (default stage "dev") and no `stages` config is provided
    const effectiveStage = this.options.stage || defaultStage;
    const noStageUsed = this.config.stages === undefined && effectiveStage == defaultStage;
    const includedInStages = this.config.stages && this.config.stages.includes(effectiveStage);
    return noStageUsed || includedInStages;
  }

  shouldMountCode() {
    return (this.config.lambda || {}).mountCode
  }

  getStageVariable() {
    this.debug('config.options_stage: ' + this.config.options_stage);
    this.debug('serverless.service.custom.stage: ' + this.serverless.service.custom.stage);
    this.debug('serverless.service.provider.stage: ' + this.serverless.service.provider.stage);
    this.config.stage = this.config.options_stage || this.serverless.service.custom.stage || this.serverless.service.provider.stage;
    this.debug('config.stage: ' + this.config.stage);
  }

  /**
   * Start the LocalStack container in Docker, if it is not running yet.
   */
  startLocalStack() {
    if (!this.config.autostart) {
      return Promise.resolve();
    }

    const getContainer = () => {
      return exec('docker ps').then(
        (stdout) => {
          const exists = stdout.split('\n').filter((line) => line.indexOf('localstack/localstack') >= 0);
          if (exists.length) {
            return exists[0].replace('\t', ' ').split(' ')[0];
          }
        }
      )
    };

    const dockerStartupTimeoutMS = 1000 * 60 * 2;

    const checkStatus = (containerID, timeout) => {
      timeout = timeout || Date.now() + dockerStartupTimeoutMS;
      if (Date.now() > timeout) {
        this.log('Warning: Timeout when checking state of LocalStack container');
        return;
      }
      return this.sleep(4000).then(() => {
        this.log(`Checking state of LocalStack container ${containerID}`)
        return exec(`docker logs "${containerID}"`).then(
          (logs) => {
            const ready = logs.split('\n').filter((line) => line.indexOf('Ready.') >= 0);
            if (ready.length) {
              return Promise.resolve();
            }
            return checkStatus(containerID, timeout);
          }
        );
      });
    }

    return getContainer().then(
      (containerID) => {
        if(containerID) {
          return;
        }
        this.log('Starting LocalStack in Docker. This can take a while.');
        const cwd = process.cwd();
        const env = this.clone(process.env);
        env.DEBUG = '1';
        env.LAMBDA_EXECUTOR = 'docker';
        env.LAMBDA_REMOTE_DOCKER = '0';
        env.DOCKER_FLAGS = (env.DOCKER_FLAGS || '') + ` -d -v ${cwd}:${cwd}`;
        env.START_WEB = '0';
        const options = {env: env};
        return exec('localstack infra start --docker', options).then(getContainer)
          .then((containerID) => checkStatus(containerID)
        );
      }
    );
  }

  /**
   * Create custom Serverless deployment bucket, if one is configured.
   */
  createDeploymentBucket() {
    const bucketName = this.serverless.service.provider.deploymentBucket;
    if (!bucketName) {
      return Promise.resolve();
    }
    const params = {};
    return this.awsProviderRequest('S3', 'listBuckets', params).then(
      (result) => {
        const found = result.Buckets.filter((b) => b.Name == bucketName);
        if (!found.length) {
          this.log('Creating deployment bucket ' + bucketName);
          return this.awsProviderRequest('S3', 'createBucket', {'Bucket': bucketName});
        }
      }
    );
  }

  /**
   * Patch S3 getBucketLocation invocation responses to return a
   * valid response ("us-east-1") instead of the default value "localhost".
   */
  patchS3BucketLocationResponse() {
    const providerRequest = (service, method, params) => {
      const result = providerRequestOrig(service, method, params);
      if (service === 'S3' && method === 'getBucketLocation') {
        return result.then((res) => {
          if (res.LocationConstraint === 'localhost') {
            res.LocationConstraint = 'us-east-1';
          }
          return Promise.resolve(res);
        })
      }
      return result;
    };
    const providerRequestOrig = this.awsProvider.request;
    this.awsProvider.request = providerRequest;
  }

  /**
   * Patch the "serverless-secrets" plugin (if enabled) to use the local SSM service endpoint
   */
  patchServerlessSecrets() {
    const slsSecretsAWS = this.findPlugin('ServerlessSecrets');
    if (slsSecretsAWS) {
      slsSecretsAWS.config.options.providerOptions = slsSecretsAWS.config.options.providerOptions || {};
      slsSecretsAWS.config.options.providerOptions.endpoint = this.getServiceURL('ssm');
      slsSecretsAWS.config.options.providerOptions.accessKeyId = 'test';
      slsSecretsAWS.config.options.providerOptions.secretAccessKey = 'test';
    }
  }

  /**
   * Patch the AWS client library to use our local endpoint URLs.
   */
  reconfigureAWS() {
    if(this.isActive()) {
      this.log('Using serverless-localstack');
      const host = this.config.host;
      const configChanges = {};

      // Configure dummy AWS credentials in the environment, to ensure the AWS client libs don't bail.
      if (!process.env.AWS_SECRET_ACCESS_KEY){
        const accessKeyId = process.env.AWS_ACCESS_KEY_ID || 'test';
        const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || 'test';
        const fakeCredentials = new AWS.Credentials({accessKeyId, secretAccessKey})
        configChanges.credentials = fakeCredentials;
      }

      // If a host has been configured, override each service
      if (host) {
        for (const service of Object.keys(this.awsServices)) {
          const serviceLower = service.toLowerCase();
          const port = this.awsServices[service];
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
      return this.createDeploymentBucket();
    }
    else {
      this.endpoints = {}
      this.log("Skipping serverless-localstack:\ncustom.localstack.stages: " +
        JSON.stringify(this.config.stages) + "\nstage: " + this.config.stage
      )
    }
  }

  /**
   * Load endpoint URLs from config file, if one exists.
   */
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

  /** Utility functions below **/

  getServiceURL(serviceName) {
    const proto = trueValues.includes(process.env.USE_SSL) ? 'https' : 'http';
    return `${proto}://localhost:${this.awsServices[serviceName]}`;
  }

  log(msg) {
    this.serverless.cli.log.call(this.serverless.cli, msg);
  }

  debug(msg) {
    if (this.config.debug) {
      this.log(msg);
    }
  }

  sleep(millis) {
    return new Promise(resolve => setTimeout(resolve, millis));
  }

  clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

}

module.exports = LocalstackPlugin;
