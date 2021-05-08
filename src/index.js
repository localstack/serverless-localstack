'use strict';
const AWS = require('aws-sdk');
const fs = require('fs');
const {promisify} = require('es6-promisify');
const exec = promisify(require('child_process').exec);

// Default stage used by Serverless
const DEFAULT_STAGE = 'dev';
// Strings or other values considered to represent "true"
const TRUE_VALUES = ['1', 'true', true];
// Plugin naming and build directory of serverless-plugin-typescript plugin
const TS_PLUGIN_TSC = 'TypeScriptPlugin'
const TYPESCRIPT_PLUGIN_BUILD_DIR_TSC = '.build'; //TODO detect from tsconfig.json
// Plugin naming and build directory of serverless-webpack plugin
const TS_PLUGIN_WEBPACK = 'ServerlessWebpack'
const TYPESCRIPT_PLUGIN_BUILD_DIR_WEBPACK = '.webpack/service'; //TODO detect from webpack.config.js

// Default edge port to use with host
const DEFAULT_EDGE_PORT = '4566';

class LocalstackPlugin {
  constructor(serverless, options) {

    this.serverless = serverless;
    this.options = options;

    this.hooks = {};
    // Define a before-hook for all event types
    for (let event in this.serverless.pluginManager.hooks) {
      const doAdd = event.startsWith('before:');
      if (doAdd && !this.hooks[event]) {
        this.hooks[event] = this.beforeEventHook.bind(this);
      }
    }
    // Define a hook for aws:info to fix output data
    this.hooks['aws:info:gatherData'] = this.fixOutputEndpoints.bind(this);

    // Define a hook for deploy:deploy to fix handler location for mounted lambda
    this.addHookInFirstPosition('deploy:deploy', this.patchTypeScriptPluginMountedCodeLocation);

    // Add a before hook for aws:common:validate and make sure it is in the very first position
    this.addHookInFirstPosition('before:aws:common:validate:validate', this.beforeEventHook);

    this.awsServices = [
      'acm',
      'amplify',
      'apigateway',
      'apigatewayv2',
      'application-autoscaling',
      'appsync',
      'athena',
      'autoscaling',
      'batch',
      'cloudformation',
      'cloudfront',
      'cloudsearch',
      'cloudtrail',
      'cloudwatch',
      'cloudwatchlogs',
      'codecommit',
      'cognito-idp',
      'cognito-identity',
      'docdb',
      'dynamodb',
      'dynamodbstreams',
      'ec2',
      'ecr',
      'ecs',
      'eks',
      'elasticache',
      'elasticbeanstalk',
      'elb',
      'elbv2',
      'emr',
      'es',
      'events',
      'firehose',
      'glacier',
      'glue',
      'iam',
      'iot',
      'iotanalytics',
      'iotevents',
      'iot-data',
      'iot-jobs-data',
      'kafka',
      'kinesis',
      'kinesisanalytics',
      'kms',
      'lambda',
      'logs',
      'mediastore',
      'neptune',
      'organizations',
      'qldb',
      'rds',
      'redshift',
      'route53',
      's3',
      's3control',
      'sagemaker',
      'sagemaker-runtime',
      'secretsmanager',
      'ses',
      'sns',
      'sqs',
      'ssm',
      'stepfunctions',
      'sts',
      'timestream',
      'transfer',
      'xray',
    ];

    // Activate the synchronous parts of plugin config here in the constructor, but
    // run the async logic in enablePlugin(..) later via the hooks.
    this.activatePlugin(true);

    // If we're using webpack, we need to make sure we retain the compiler output directory
    if (this.detectTypescriptPluginType() === TS_PLUGIN_WEBPACK) {
      const p = this.serverless.pluginManager.plugins.find((x) => x.constructor.name === TS_PLUGIN_WEBPACK);
      if (
        this.shouldMountCode() && (
          !p ||
          !p.serverless ||
          !p.serverless.configurationInput ||
          !p.serverless.configurationInput.custom ||
          !p.serverless.configurationInput.custom.webpack ||
          !p.serverless.configurationInput.custom.webpack.keepOutputDirectory
        )
      ) {
        throw new Error('When mounting Lambda code, you must retain webpack output directory. '
          + 'Set custom.webpack.keepOutputDirectory to true.');
      }
    }
  }

  addHookInFirstPosition(eventName, hookFunction) {
    this.serverless.pluginManager.hooks[eventName] = this.serverless.pluginManager.hooks[eventName] || [];
    this.serverless.pluginManager.hooks[eventName].unshift(
      { pluginName: 'LocalstackPlugin', hook: hookFunction.bind(this, eventName) });
  }

  activatePlugin(preHooks) {
    this.readConfig(preHooks);

    if (this.pluginActivated || !this.isActive()) {
      return Promise.resolve();
    }

    // Intercept Provider requests
    if (!this.awsProviderRequest) {
      const awsProvider = this.getAwsProvider();
      this.awsProviderRequest = awsProvider.request.bind(awsProvider);
      awsProvider.request = this.interceptRequest.bind(this);
    }

    // Reconfigure AWS clients
    try {
      this.reconfigureAWS();
    } catch (e) {
      // This can happen if we are executing in the plugin initialization context and
      // the template variables have not been fully initialized yet
      // (e.g., "Error: Profile ${self:custom.stage}Profile does not exist")
      return;
    }

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
    this.skipIfMountLambda('AwsCompileFunctions', 'downloadPackageArtifacts');
    this.skipIfMountLambda('AwsDeploy', 'extendedValidate');
    this.skipIfMountLambda('AwsDeploy', 'uploadFunctionsAndLayers');
    if (this.detectTypescriptPluginType()) {
      this.skipIfMountLambda(this.detectTypescriptPluginType(), 'cleanup', null, [
        'after:package:createDeploymentArtifacts', 'after:deploy:function:packageFunction']);
    }

    this.pluginActivated = true;
  }

  beforeEventHook() {
    if (this.pluginEnabled) {
      return Promise.resolve();
    }

    this.activatePlugin();

    this.pluginEnabled = true;
    return this.enablePlugin();
  }

  enablePlugin() {
    // reconfigure AWS endpoints based on current stage variables
    this.getStageVariable();

    return this.startLocalStack().then(
      () => {
          this.patchServerlessSecrets();
          this.patchS3BucketLocationResponse();
      }
    );
  }

  // Convenience method for detecting JS/TS transpiler
  detectTypescriptPluginType() {
    if (this.findPlugin(TS_PLUGIN_TSC)) return TS_PLUGIN_TSC
    if (this.findPlugin(TS_PLUGIN_WEBPACK)) return TS_PLUGIN_WEBPACK
    return undefined
  }

  // Convenience method for getting build directory of installed JS/TS transpiler
  getTSBuildDir() {
    const TS_PLUGIN = this.detectTypescriptPluginType()
    if (TS_PLUGIN === TS_PLUGIN_TSC) return TYPESCRIPT_PLUGIN_BUILD_DIR_TSC
    if (TS_PLUGIN === TS_PLUGIN_WEBPACK) return TYPESCRIPT_PLUGIN_BUILD_DIR_WEBPACK
    return undefined
  }

  findPlugin(name) {
    return this.serverless.pluginManager.plugins.find(p => p.constructor.name === name);
  }

  skipIfMountLambda(pluginName, functionName, overrideFunction, hookNames) {
    const plugin = this.findPlugin(pluginName);
    if (!plugin) {
      this.log('Warning: Unable to find plugin named: ' + pluginName)
      return;
    }
    if (!plugin[functionName]) {
      this.log(`Unable to find function ${functionName} on plugin ${pluginName}`)
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
    const boundOverrideFunction = overrideFunction.bind(this);
    plugin[functionName] = boundOverrideFunction;

    // overwrite bound functions for specified hook names
    (hookNames || []).forEach(
      (hookName) => {
        plugin.hooks[hookName] = boundOverrideFunction;
        const slsHooks = this.serverless.pluginManager.hooks[hookName] || [];
        slsHooks.forEach(
          (hookItem) => {
            if (hookItem.pluginName === pluginName) {
              hookItem.hook = boundOverrideFunction;
            }
          }
        );
      }
    );
  }

  readConfig(preHooks) {
    if (this.configInitialized) {
      return;
    }

    const localstackConfig = (this.serverless.service.custom || {}).localstack || {};
    this.config = Object.assign({}, this.options, localstackConfig);

    //Get the target deployment stage
    this.config.stage = "";
    this.config.options_stage = this.options.stage || undefined;

    // read current stage variable - to determine whether to reconfigure AWS endpoints
    this.getStageVariable();

    // If the target stage is listed in config.stages use the serverless-localstack-plugin
    // To keep default behavior if config.stages is undefined, then use serverless-localstack-plugin
    this.endpoints = this.endpoints || this.config.endpoints || {};
    this.endpointFile = this.config.endpointFile;
    if (this.endpointFile && !this._endpointFileLoaded && this.isActive()) {
      try {
        this.loadEndpointsFromDisk(this.endpointFile);
        this._endpointFileLoaded = true;
      } catch (e) {
        if (!this.endpointFile.includes('${')) {
          throw e;
        }
        // Could be related to variable references not being resolved yet, and hence the endpoints file
        // name looks something like "${env:ENDPOINT_FILE}" -> this readConfig() function is called multiple
        // times from plugin hooks, hence we return here and expect that next time around it may work...
        return;
      }
    }

    this.configInitialized = this.configInitialized || !preHooks;
  }

  isActive() {
    // Activate the plugin if either:
    //   (1) the serverless stage (explicitly defined or default stage "dev") is included in the `stages` config; or
    //   (2) serverless is invoked without a --stage flag (default stage "dev") and no `stages` config is provided
    const effectiveStage = this.options.stage || this.config.stage || DEFAULT_STAGE;
    const noStageUsed = this.config.stages === undefined && effectiveStage == DEFAULT_STAGE;
    const includedInStages = this.config.stages && this.config.stages.includes(effectiveStage);
    return noStageUsed || includedInStages;
  }

  shouldMountCode() {
    return (this.config.lambda || {}).mountCode;
  }

  shouldRunDockerSudo() {
    return (this.config.docker || {}).sudo;
  }

  getStageVariable() {
    const customConfig = this.serverless.service.custom || {};
    const providerConfig = this.serverless.service.provider || {};
    this.debug('config.options_stage: ' + this.config.options_stage);
    this.debug('serverless.service.custom.stage: ' + customConfig.stage);
    this.debug('serverless.service.provider.stage: ' + providerConfig.stage);
    this.config.stage = this.config.options_stage || customConfig.stage || providerConfig.stage;
    this.debug('config.stage: ' + this.config.stage);
  }

  fixOutputEndpoints() {
    if(!this.isActive()) {
      return;
    }
    const plugin = this.findPlugin('AwsInfo');
    const endpoints = plugin.gatheredData.info.endpoints || [];
    const edgePort = this.getEdgePort();
    endpoints.forEach((entry, idx) => {
      // endpoint format for old Serverless versions
      const regex = /[^\s:]*:\/\/([^.]+)\.execute-api[^/]+\/([^/]+)(\/.*)?/g;
      const replace = `http://localhost:${edgePort}/restapis/$1/$2/_user_request_$3`;
      entry = entry.replace(regex, replace);
      // endpoint format for newer Serverless versions, e.g.:
      //   - https://2e22431f.execute-api.us-east-1.localhost
      //   - https://2e22431f.execute-api.us-east-1.localhost.localstack.cloud
      //   - https://2e22431f.execute-api.us-east-1.amazonaws.com
      const regex2 = /[^\s:]*:\/\/([^.]+)\.execute-api\.[^/]+(\/([^/]+)(\/.*)?)?/g;
      const replace2 = `https://$1.execute-api.localhost.localstack.cloud:${edgePort}$2`;
      endpoints[idx] = entry.replace(regex2, replace2);
    });

    // Replace ServerlessStepFunctions display
    this.stepFunctionsReplaceDisplay()
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
          const exists = stdout.split('\n').filter((line) => line.indexOf('localstack/localstack') >= 0 || line.indexOf('localstack_localstack') >= 0);
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
        env.LAMBDA_EXECUTOR = env.LAMBDA_EXECUTOR || 'docker';
        env.LAMBDA_REMOTE_DOCKER = env.LAMBDA_REMOTE_DOCKER || '0';
        env.DOCKER_FLAGS = (env.DOCKER_FLAGS || '') + ` -d -v ${cwd}:${cwd}`;
        env.START_WEB = env.START_WEB || '0';
        const maxBuffer = (+env.EXEC_MAXBUFFER)||50*1000*1000; // 50mb buffer to handle output
        if (this.shouldRunDockerSudo()) {
          env.DOCKER_CMD = 'sudo docker';
        }
        const options = {env: env, maxBuffer};
        return exec('localstack infra start --docker', options).then(getContainer)
          .then((containerID) => checkStatus(containerID)
        );
      }
    );
  }

  /**
   * Patch code location in case (1) serverless-plugin-typescript is
   * used, and (2) lambda.mountCode is enabled.
   */
  patchTypeScriptPluginMountedCodeLocation() {
    if (!this.shouldMountCode() || !this.detectTypescriptPluginType()) {
      return;
    }
    const template = this.serverless.service.provider.compiledCloudFormationTemplate || {};
    const resources = template.Resources || {};
    Object.keys(resources).forEach(
      (resName) => {
        const resEntry = resources[resName];
        if (resEntry.Type === 'AWS::Lambda::Function') {
          resEntry.Properties.Handler = `${this.getTSBuildDir()}/${resEntry.Properties.Handler}`;
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
    const awsProvider = this.getAwsProvider();
    const providerRequestOrig = awsProvider.request.bind(awsProvider);
    awsProvider.request = providerRequest;
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
      const host = this.config.host || 'http://localhost';
      const edgePort = this.getEdgePort();
      const configChanges = {};

      // Configure dummy AWS credentials in the environment, to ensure the AWS client libs don't bail.
      const awsProvider = this.getAwsProvider();
      const tmpCreds = awsProvider.getCredentials();
      if (!tmpCreds.credentials){
        const accessKeyId = process.env.AWS_ACCESS_KEY_ID || 'test';
        const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || 'test';
        const fakeCredentials = new AWS.Credentials({accessKeyId, secretAccessKey});
        configChanges.credentials = fakeCredentials;
        // set environment variables, ...
        process.env.AWS_ACCESS_KEY_ID = accessKeyId;
        process.env.AWS_SECRET_ACCESS_KEY = secretAccessKey;
        // ..., then populate cache with new credentials
        awsProvider.cachedCredentials = null;
        awsProvider.getCredentials();
      }

      // If a host has been configured, override each service
      const localEndpoint = `${host}:${edgePort}`;
      for (const service of this.awsServices) {
        const serviceLower = service.toLowerCase();

        this.debug(`Reconfiguring service ${service} to use ${localEndpoint}`);
        configChanges[serviceLower] = { endpoint: localEndpoint };

        if (serviceLower == 's3') {
          configChanges[serviceLower].s3ForcePathStyle = true;
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
      awsProvider.sdk.config.update(configChanges);
      if (awsProvider.cachedCredentials) {
        // required for compatibility with certain plugin, e.g., serverless-domain-manager
        awsProvider.cachedCredentials.endpoint = localEndpoint;
      }
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
      throw new ReferenceError(`Endpoint file "${this.endpointFile}" is invalid: ${err}`)
    }

    for (const key of Object.keys(endpointJson)) {
      this.debug('Intercepting service ' + key);
      this.endpoints[key] = endpointJson[key];
    }
  }

  interceptRequest(service, method, params) {

    // Enable the plugin here, if not yet enabled (the function call below is idempotent).
    // TODO: It seems that we can potentially remove the hooks / plugin loading logic
    //    entirely and only rely on activating the -> we should evaluate this, as it would
    //    substantially simplify the code in this file.
    this.beforeEventHook();

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

  getEdgePort() {
    return this.config.edgePort || DEFAULT_EDGE_PORT;
  }

  getAwsProvider() {
    this.awsProvider = this.awsProvider || this.serverless.getProvider('aws');
    return this.awsProvider;
  }

  getServiceURL() {
    const proto = TRUE_VALUES.includes(process.env.USE_SSL) ? 'https' : 'http';
    return `${proto}://localhost:${this.getEdgePort()}`;
  }

  log(msg) {
    if (this.serverless.cli) {
      this.serverless.cli.log.call(this.serverless.cli, msg);
    }
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

  stepFunctionsReplaceDisplay() {
    const plugin = this.findPlugin('ServerlessStepFunctions');
    if (plugin) {
      const endpoint = this.getServiceURL()
      plugin.originalDisplay = plugin.display;
      plugin.localstackEndpoint = endpoint;

      const newDisplay = function () {
        const regex = /.*:\/\/([^.]+)\.execute-api[^/]+\/([^/]+)(\/.*)?/g;
        let newEndpoint = this.localstackEndpoint +'/restapis/$1/$2/_user_request_$3'
        this.endpointInfo = this.endpointInfo.replace(regex, newEndpoint)
        this.originalDisplay();
      }

      newDisplay.bind(plugin)
      plugin.display = newDisplay;
    }
  }

}

module.exports = LocalstackPlugin;
