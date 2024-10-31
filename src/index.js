'use strict';
const AdmZip = require('adm-zip');
const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { promisify } = require('es6-promisify');
const exec = promisify(require('child_process').exec);

// Default stage used by Serverless
const DEFAULT_STAGE = 'dev';
// Strings or other values considered to represent "true"
const TRUE_VALUES = ['1', 'true', true];
// Plugin naming and build directory of serverless-plugin-typescript plugin
const TS_PLUGIN_TSC = 'TypeScriptPlugin';
const TYPESCRIPT_PLUGIN_BUILD_DIR_TSC = '.build'; //TODO detect from tsconfig.json
// Plugin naming and build directory of serverless-webpack plugin
const TS_PLUGIN_WEBPACK = 'ServerlessWebpack';
const TYPESCRIPT_PLUGIN_BUILD_DIR_WEBPACK = '.webpack/service'; //TODO detect from webpack.config.js
// Plugin naming and build directory of serverless-webpack plugin
const TS_PLUGIN_ESBUILD = 'EsbuildServerlessPlugin';
const TYPESCRIPT_PLUGIN_BUILD_DIR_ESBUILD = '.esbuild/.build'; //TODO detect from esbuild.config.js
// Plugin naming and build directory of esbuild built-in with Serverless Framework
const TS_PLUGIN_BUILTIN_ESBUILD = 'Esbuild';
const TYPESCRIPT_PLUGIN_BUILD_DIR_BUILTIN_ESBUILD = '.serverless/build'; //TODO detect from esbuild.config.js

// Default AWS endpoint URL
const DEFAULT_AWS_ENDPOINT_URL = 'http://localhost:4566';

// Cache hostname to avoid unnecessary connection checks
let resolvedHostname = undefined;

const awsEndpointUrl = process.env.AWS_ENDPOINT_URL || DEFAULT_AWS_ENDPOINT_URL;

class LocalstackPlugin {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;
    this.hooks = { initialize: () => this.init() };
    // Define a before-hook for all event types
    for (const event in this.serverless.pluginManager.hooks) {
      const doAdd = event.startsWith('before:');
      if (doAdd && !this.hooks[event]) {
        this.hooks[event] = this.beforeEventHook.bind(this);
      }
    }
    // Define a hook for aws:info to fix output data
    this.hooks['aws:info:gatherData'] = this.fixOutputEndpoints.bind(this);

    // Define a hook for deploy:deploy to fix handler location for mounted lambda
    this.addHookInFirstPosition(
      'deploy:deploy',
      this.patchTypeScriptPluginMountedCodeLocation,
    );

    // Add a before hook for aws:common:validate and make sure it is in the very first position
    this.addHookInFirstPosition(
      'before:aws:common:validate:validate',
      this.beforeEventHook,
    );

    // Add a hook to fix TypeError when accessing undefined state attribute
    this.addHookInFirstPosition(
      'before:aws:deploy:deploy:checkForChanges',
      this.beforeDeployCheckForChanges,
    );

    const compileEventsHooks =
      this.serverless.pluginManager.hooks['package:compileEvents'] || [];
    compileEventsHooks.push({
      pluginName: 'LocalstackPlugin',
      hook: this.patchCustomResourceLambdaS3ForcePathStyle.bind(this),
    });

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
      const p = this.serverless.pluginManager.plugins.find(
        (x) => x.constructor.name === TS_PLUGIN_WEBPACK,
      );
      if (
        this.shouldMountCode() &&
        (!p ||
          !p.serverless ||
          !p.serverless.configurationInput ||
          !p.serverless.configurationInput.custom ||
          !p.serverless.configurationInput.custom.webpack ||
          !p.serverless.configurationInput.custom.webpack.keepOutputDirectory)
      ) {
        throw new Error(
          'When mounting Lambda code, you must retain webpack output directory. ' +
            'Set custom.webpack.keepOutputDirectory to true.',
        );
      }
    }
  }

  async init() {
    await this.reconfigureAWS();
  }

  addHookInFirstPosition(eventName, hookFunction) {
    this.serverless.pluginManager.hooks[eventName] =
      this.serverless.pluginManager.hooks[eventName] || [];
    this.serverless.pluginManager.hooks[eventName].unshift({
      pluginName: 'LocalstackPlugin',
      hook: hookFunction.bind(this, eventName),
    });
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

    // Patch plugin methods
    function compileFunction(functionName) {
      const functionObject = this.serverless.service.getFunction(functionName);
      if (functionObject.image || !this.shouldMountCode()) {
        return compileFunction._functionOriginal.apply(null, arguments);
      }
      functionObject.package = functionObject.package || {};
      functionObject.package.artifact = __filename;
      return compileFunction._functionOriginal
        .apply(null, arguments)
        .then(() => {
          const resources =
            this.serverless.service.provider.compiledCloudFormationTemplate
              .Resources;
          Object.keys(resources).forEach((id) => {
            const res = resources[id];
            if (res.Type === 'AWS::Lambda::Function') {
              res.Properties.Code.S3Bucket =
                process.env.BUCKET_MARKER_LOCAL || 'hot-reload'; // default changed to 'hot-reload' with LS v2 release
              res.Properties.Code.S3Key = process.cwd();
              const mountCode = this.config.lambda.mountCode;
              if (
                typeof mountCode === 'string' &&
                mountCode.toLowerCase() !== 'true'
              ) {
                res.Properties.Code.S3Key = path.join(
                  res.Properties.Code.S3Key,
                  this.config.lambda.mountCode,
                );
              }
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
    this.skipIfMountLambda(
      'AwsCompileFunctions',
      'compileFunction',
      compileFunction,
    );
    this.skipIfMountLambda('AwsCompileFunctions', 'downloadPackageArtifacts');
    this.skipIfMountLambda('AwsDeploy', 'extendedValidate');
    if (this.detectTypescriptPluginType()) {
      this.skipIfMountLambda(
        this.detectTypescriptPluginType(),
        'cleanup',
        null,
        [
          'after:package:createDeploymentArtifacts',
          'after:deploy:function:packageFunction',
        ],
      );
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

  beforeDeployCheckForChanges() {
    // patch to avoid "TypeError: reading 'console' of undefined" in plugins/aws/deploy/index.js on Sls v3.17.0+
    const plugin = this.findPlugin('AwsDeploy');
    if (plugin) {
      plugin.state = plugin.state || {};
    }
  }

  enablePlugin() {
    // reconfigure AWS endpoints based on current stage variables
    this.getStageVariable();

    return this.startLocalStack().then(() => {
      this.patchServerlessSecrets();
      this.patchS3BucketLocationResponse();
      this.patchS3CreateBucketLocationConstraint();
    });
  }

  // Convenience method for detecting JS/TS transpiler
  detectTypescriptPluginType() {
    if (this.findPlugin(TS_PLUGIN_TSC)) return TS_PLUGIN_TSC;
    if (this.findPlugin(TS_PLUGIN_WEBPACK)) return TS_PLUGIN_WEBPACK;
    if (this.findPlugin(TS_PLUGIN_ESBUILD)) return TS_PLUGIN_ESBUILD;
    const builtinEsbuildPlugin = this.findPlugin(TS_PLUGIN_BUILTIN_ESBUILD);
    if (builtinEsbuildPlugin &&
      builtinEsbuildPlugin.constructor &&
      typeof builtinEsbuildPlugin.constructor.WillEsBuildRun === 'function' &&
      builtinEsbuildPlugin.constructor.WillEsBuildRun(this.serverless.configurationInput, this.serverless.serviceDir)) {
      return TS_PLUGIN_BUILTIN_ESBUILD;
    }
    return undefined;
  }

  // Convenience method for getting build directory of installed JS/TS transpiler
  getTSBuildDir() {
    const TS_PLUGIN = this.detectTypescriptPluginType();
    if (TS_PLUGIN === TS_PLUGIN_TSC) return TYPESCRIPT_PLUGIN_BUILD_DIR_TSC;
    if (TS_PLUGIN === TS_PLUGIN_WEBPACK)
      return TYPESCRIPT_PLUGIN_BUILD_DIR_WEBPACK;
    if (TS_PLUGIN === TS_PLUGIN_ESBUILD)
      return TYPESCRIPT_PLUGIN_BUILD_DIR_ESBUILD;
    if (TS_PLUGIN === TS_PLUGIN_BUILTIN_ESBUILD) {
      return TYPESCRIPT_PLUGIN_BUILD_DIR_BUILTIN_ESBUILD;
    }
    return undefined;
  }

  findPlugin(name) {
    return this.serverless.pluginManager.plugins.find(
      (p) => p.constructor.name === name,
    );
  }

  skipIfMountLambda(pluginName, functionName, overrideFunction, hookNames) {
    const plugin = this.findPlugin(pluginName);
    if (!plugin) {
      this.log('Warning: Unable to find plugin named: ' + pluginName);
      return;
    }
    if (!plugin[functionName]) {
      this.log(
        `Unable to find function ${functionName} on plugin ${pluginName}`,
      );
      return;
    }
    const functionOriginal = plugin[functionName].bind(plugin);

    function overrideFunctionDefault() {
      if (this.shouldMountCode()) {
        const fqn = pluginName + '.' + functionName;
        this.log(
          'Skip plugin function ' + fqn + ' (lambda.mountCode flag is enabled)',
        );
        return Promise.resolve();
      }
      return functionOriginal.apply(null, arguments);
    }

    overrideFunction = overrideFunction || overrideFunctionDefault;
    overrideFunction._functionOriginal = functionOriginal;
    const boundOverrideFunction = overrideFunction.bind(this);
    plugin[functionName] = boundOverrideFunction;

    // overwrite bound functions for specified hook names
    (hookNames || []).forEach((hookName) => {
      plugin.hooks[hookName] = boundOverrideFunction;
      const slsHooks = this.serverless.pluginManager.hooks[hookName] || [];
      slsHooks.forEach((hookItem) => {
        if (hookItem.pluginName === pluginName) {
          hookItem.hook = boundOverrideFunction;
        }
      });
    });
  }

  readConfig(preHooks) {
    if (this.configInitialized) {
      return;
    }

    const localstackConfig =
      (this.serverless.service.custom || {}).localstack || {};
    this.config = Object.assign({}, this.options, localstackConfig);

    //Get the target deployment stage
    this.config.stage = '';
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
    const effectiveStage =
      this.options.stage || this.config.stage || DEFAULT_STAGE;
    const noStageUsed =
      this.config.stages === undefined && effectiveStage == DEFAULT_STAGE;
    const includedInStages =
      this.config.stages && this.config.stages.includes(effectiveStage);
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
    this.config.stage =
      this.config.options_stage || customConfig.stage || providerConfig.stage;
    this.debug('config.stage: ' + this.config.stage);
  }

  fixOutputEndpoints() {
    if (!this.isActive()) {
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
      const regex2 =
        /[^\s:]*:\/\/([^.]+)\.execute-api\.[^/]+(([^/]+)(\/.*)?)?\/*$/g;
      const replace2 = `https://$1.execute-api.localhost.localstack.cloud:${edgePort}$2`;
      endpoints[idx] = entry.replace(regex2, replace2);
    });

    // Replace ServerlessStepFunctions display
    this.stepFunctionsReplaceDisplay();
  }

  /**
   * Start the LocalStack container in Docker, if it is not running yet.
   */
  startLocalStack() {
    if (!(this.config.autostart && this.isActive())) {
      return Promise.resolve();
    }

    const getContainer = () => {
      return exec('docker ps').then((stdout) => {
        const exists = stdout
          .split('\n')
          .filter(
            (line) =>
              line.indexOf('localstack/localstack') >= 0 ||
              line.indexOf('localstack/localstack-pro') >= 0 ||
              line.indexOf('localstack_localstack') >= 0,
          );
        if (exists.length) {
          return exists[0].replace('\t', ' ').split(' ')[0];
        }
      });
    };

    const dockerStartupTimeoutMS = 1000 * 60 * 2;

    const checkStatus = (containerID, timeout) => {
      timeout = timeout || Date.now() + dockerStartupTimeoutMS;
      if (Date.now() > timeout) {
        this.log(
          'Warning: Timeout when checking state of LocalStack container',
        );
        return;
      }
      return this.sleep(4000).then(() => {
        this.log(`Checking state of LocalStack container ${containerID}`);
        return exec(`docker logs "${containerID}"`).then((logs) => {
          const ready = logs
            .split('\n')
            .filter((line) => line.indexOf('Ready.') >= 0);
          if (ready.length) {
            return Promise.resolve();
          }
          return checkStatus(containerID, timeout);
        });
      });
    };

    const addNetworks = async (containerID) => {
      if (this.config.networks) {
        for (const network in this.config.networks) {
          await exec(
            `docker network connect "${this.config.networks[network]}" ${containerID}`,
          );
        }
      }
      return containerID;
    };

    const startContainer = () => {
      this.log('Starting LocalStack in Docker. This can take a while.');
      const cwd = process.cwd();
      const env = this.clone(process.env);
      env.DEBUG = '1';
      env.LAMBDA_EXECUTOR = env.LAMBDA_EXECUTOR || 'docker';
      env.LAMBDA_REMOTE_DOCKER = env.LAMBDA_REMOTE_DOCKER || '0';
      env.DOCKER_FLAGS = (env.DOCKER_FLAGS || '') + ` -v ${cwd}:${cwd}`;
      env.START_WEB = env.START_WEB || '0';
      const maxBuffer = +env.EXEC_MAXBUFFER || 50 * 1000 * 1000; // 50mb buffer to handle output
      if (this.shouldRunDockerSudo()) {
        env.DOCKER_CMD = 'sudo docker';
      }
      const options = { env: env, maxBuffer };
      return exec('localstack start -d', options)
        .then(getContainer)
        .then((containerID) => addNetworks(containerID))
        .then((containerID) => checkStatus(containerID));
    };

    const startCompose = () => {
      this.log(
        'Starting LocalStack using the provided docker-compose file. This can take a while.',
      );
      return exec(
        `docker-compose -f ${this.config.docker.compose_file} up -d`,
      ).then(getContainer);
    };

    return getContainer().then((containerID) => {
      if (containerID) {
        return;
      }

      if (this.config.docker && this.config.docker.compose_file) {
        return startCompose();
      }

      return startContainer();
    });
  }

  /**
   * Patch code location in case (1) serverless-plugin-typescript is
   * used, and (2) lambda.mountCode is enabled.
   */
  patchTypeScriptPluginMountedCodeLocation() {
    if (
      !this.shouldMountCode() ||
      !this.detectTypescriptPluginType() ||
      !this.isActive()
    ) {
      return;
    }
    const template =
      this.serverless.service.provider.compiledCloudFormationTemplate || {};
    const resources = template.Resources || {};
    Object.keys(resources).forEach((resName) => {
      const resEntry = resources[resName];
      if (resEntry.Type === 'AWS::Lambda::Function') {
        resEntry.Properties.Handler = `${this.getTSBuildDir()}/${resEntry.Properties.Handler}`;
      }
    });
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
        });
      }
      return result;
    };
    const awsProvider = this.getAwsProvider();
    const providerRequestOrig = awsProvider.request.bind(awsProvider);
    awsProvider.request = providerRequest;
  }

  /**
   * Patch S3 createBucket invocation to not add a LocationContraint if the region is `us-east-1`
   * The default SDK check was against endpoint and not the region directly.
   */
  patchS3CreateBucketLocationConstraint() {
    AWS.util.update(AWS.S3.prototype, {
      createBucket: function createBucket(params, callback) {
        // When creating a bucket *outside* the classic region, the location
        // constraint must be set for the bucket and it must match the endpoint.
        // This chunk of code will set the location constraint param based
        // on the region (when possible), but it will not override a passed-in
        // location constraint.
        if (typeof params === 'function' || !params) {
          callback = callback || params;
          params = {};
        }
        // copy params so that appending keys does not unintentionallly
        // mutate params object argument passed in by user
        const copiedParams = AWS.util.copy(params);
        if (
          this.config.region !== 'us-east-1' &&
          !params.CreateBucketConfiguration
        ) {
          copiedParams.CreateBucketConfiguration = {
            LocationConstraint: this.config.region,
          };
        }
        return this.makeRequest('createBucket', copiedParams, callback);
      },
    });
  }

  /**
   * Patch the "serverless-secrets" plugin (if enabled) to use the local SSM service endpoint
   */
  patchServerlessSecrets() {
    const slsSecretsAWS = this.findPlugin('ServerlessSecrets');
    if (slsSecretsAWS) {
      slsSecretsAWS.config.options.providerOptions =
        slsSecretsAWS.config.options.providerOptions || {};
      slsSecretsAWS.config.options.providerOptions.endpoint =
        this.getServiceURL();
      slsSecretsAWS.config.options.providerOptions.accessKeyId = 'test';
      slsSecretsAWS.config.options.providerOptions.secretAccessKey = 'test';
    }
  }

  /**
   * Patch the AWS client library to use our local endpoint URLs.
   */
  async reconfigureAWS() {
    if (this.isActive()) {
      if (this.reconfiguredEndpoints) {
        this.debug(
          'Skipping reconfiguring of endpoints (already reconfigured)',
        );
        return;
      }
      this.log('Using serverless-localstack');
      const hostname = await this.getConnectHostname();

      const configChanges = {};

      // Configure dummy AWS credentials in the environment, to ensure the AWS client libs don't bail.
      const awsProvider = this.getAwsProvider();
      const tmpCreds = awsProvider.getCredentials();
      if (!tmpCreds.credentials) {
        const accessKeyId = process.env.AWS_ACCESS_KEY_ID || 'test';
        const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || 'test';
        const fakeCredentials = new AWS.Credentials({
          accessKeyId,
          secretAccessKey,
        });
        configChanges.credentials = fakeCredentials;
        // set environment variables, ...
        process.env.AWS_ACCESS_KEY_ID = accessKeyId;
        process.env.AWS_SECRET_ACCESS_KEY = secretAccessKey;
        // ..., then populate cache with new credentials
        awsProvider.cachedCredentials = null;
        awsProvider.getCredentials();
      }

      // If a host has been configured, override each service
      const localEndpoint = this.getServiceURL(hostname);
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
      this.log('serverless-localstack: Reconfigured endpoints');
      this.reconfiguredEndpoints = true;
    } else {
      this.endpoints = {};
      this.log(
        'Skipping serverless-localstack:\ncustom.localstack.stages: ' +
          JSON.stringify(this.config.stages) +
          '\nstage: ' +
          this.config.stage,
      );
    }
  }

  /**
   * Load endpoint URLs from config file, if one exists.
   */
  loadEndpointsFromDisk(endpointFile) {
    let endpointJson;

    this.debug('Loading endpointJson from ' + endpointFile);

    try {
      endpointJson = JSON.parse(fs.readFileSync(endpointFile));
    } catch (err) {
      throw new ReferenceError(
        `Endpoint file "${this.endpointFile}" is invalid: ${err}`,
      );
    }

    for (const key of Object.keys(endpointJson)) {
      this.debug('Intercepting service ' + key);
      this.endpoints[key] = endpointJson[key];
    }
  }

  async interceptRequest(service, method, params) {
    // Enable the plugin here, if not yet enabled (the function call below is idempotent).
    // TODO: It seems that we can potentially remove the hooks / plugin loading logic
    //    entirely and only rely on activating the -> we should evaluate this, as it would
    //    substantially simplify the code in this file.
    this.beforeEventHook();
    // Template validation is not supported in LocalStack
    if (method == 'validateTemplate') {
      this.log('Skipping template validation: Unsupported in Localstack');
      return Promise.resolve('');
    }

    const config = AWS.config[service.toLowerCase()]
      ? AWS.config
      : this.getAwsProvider().sdk.config;
    if (config[service.toLowerCase()]) {
      this.debug(
        `Using custom endpoint for ${service}: ${config[service.toLowerCase()].endpoint}`,
      );

      if (config.s3 && params.TemplateURL) {
        this.debug(`Overriding S3 templateUrl to ${config.s3.endpoint}`);
        params.TemplateURL = params.TemplateURL.replace(
          /https:\/\/s3.amazonaws.com/,
          config.s3.endpoint,
        );
      }
    }
    await this.reconfigureAWS();

    return this.awsProviderRequest(service, method, params);
  }

  /* Utility functions below */

  getEndpointPort() {
    const url = new URL(awsEndpointUrl);
    return url.port;
  }

  getEndpointHostname() {
    const url = new URL(awsEndpointUrl);
    return url.hostname;
  }

  getEndpointProtocol() {
    const url = new URL(awsEndpointUrl);
    return url.protocol.replace(':', '');
  }

  getEdgePort() {
    return (
      process.env.EDGE_PORT || this.config.edgePort || this.getEndpointPort()
    );
  }

  /**
   * Determine the target hostname to connect to, as per the configuration.
   */
  async getConnectHostname() {
    if (resolvedHostname) {
      // Use cached hostname to avoid repeated connection checks
      return resolvedHostname;
    }

    let hostname =
      process.env.LOCALSTACK_HOSTNAME || this.getEndpointHostname();
    if (this.config.host) {
      hostname = this.config.host;
      if (hostname.indexOf('://') !== -1) {
        hostname = new URL(hostname).hostname;
      }
    }

    // Fall back to using local IPv4 address if connection to localhost fails.
    // This workaround transparently handles systems (e.g., macOS) where
    // localhost resolves to IPv6 when using Nodejs >=v17. See discussion:
    // https://github.com/localstack/aws-cdk-local/issues/76#issuecomment-1412590519
    // Issue: https://github.com/localstack/serverless-localstack/issues/125
    if (hostname === 'localhost') {
      try {
        const port = this.getEdgePort();
        const options = { host: hostname, port: port };
        await this.checkTCPConnection(options);
      } catch (e) {
        const fallbackHostname = '127.0.0.1';
        this.debug(
          `Reconfiguring hostname to use ${fallbackHostname} (IPv4) because connection to ${hostname} failed`,
        );
        hostname = fallbackHostname;
      }
    }

    // Cache resolved hostname
    resolvedHostname = hostname;
    return hostname;
  }

  /**
   * Checks whether a TCP connection to the given "options" can be established.
   * @param {object} options connection options of net.socket.connect()
   *                 https://nodejs.org/api/net.html#socketconnectoptions-connectlistener
   *                 Example: { host: "localhost", port: 4566 }
   * @returns {Promise} A fulfilled empty promise on successful connection and
   *                    a rejected promise on any connection error.
   */
  checkTCPConnection(options) {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      const client = socket.connect(options, () => {
        client.end();
        resolve();
      });

      client.setTimeout(500); // milliseconds
      client.on('timeout', (err) => {
        client.destroy();
        reject(err);
      });

      client.on('error', (err) => {
        client.destroy();
        reject(err);
      });
    });
  }

  getAwsProvider() {
    this.awsProvider = this.awsProvider || this.serverless.getProvider('aws');
    return this.awsProvider;
  }

  getServiceURL(hostname) {
    if (process.env.AWS_ENDPOINT_URL) {
      return this.injectHostnameIntoLocalhostURL(
        process.env.AWS_ENDPOINT_URL,
        hostname,
      );
    }
    hostname = hostname || 'localhost';

    let proto = this.getEndpointProtocol();
    if (process.env.USE_SSL) {
      proto = TRUE_VALUES.includes(process.env.USE_SSL) ? 'https' : 'http';
    } else if (this.config.host) {
      proto = this.config.host.split('://')[0];
    }
    const port = this.getEdgePort();
    // little hack here - required to remove the default HTTPS port 443, as otherwise
    // routing for some platforms and ephemeral instances (e.g., on namespace.so) fails
    const isDefaultPort =
      (proto === 'http' && `${port}` === '80') ||
      (proto === 'https' && `${port}` === '443');
    if (isDefaultPort) {
      return `${proto}://${hostname}`;
    }
    return `${proto}://${hostname}:${port}`;
  }

  /**
   * If the given `endpointURL` points to `localhost`, then inject the given `hostname` into the URL
   * and return it. This helps fix IPv6 issues with node v18+ (see also getConnectHostname() above)
   */
  injectHostnameIntoLocalhostURL(endpointURL, hostname) {
    const url = new URL(endpointURL);
    if (hostname && url.hostname === 'localhost') {
      url.hostname = hostname;
    }
    return url.origin;
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
    return new Promise((resolve) => setTimeout(resolve, millis));
  }

  clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  stepFunctionsReplaceDisplay() {
    const plugin = this.findPlugin('ServerlessStepFunctions');
    if (plugin) {
      const endpoint = this.getServiceURL();
      plugin.originalDisplay = plugin.display;
      plugin.localstackEndpoint = endpoint;

      const newDisplay = function () {
        const regex = /.*:\/\/([^.]+)\.execute-api[^/]+\/([^/]+)(\/.*)?/g;
        const newEndpoint =
          this.localstackEndpoint + '/restapis/$1/$2/_user_request_$3';
        if (this.endpointInfo) {
          this.endpointInfo = this.endpointInfo.replace(regex, newEndpoint);
        }
        this.originalDisplay();
      };

      newDisplay.bind(plugin);
      plugin.display = newDisplay;
    }
  }
  patchCustomResourceLambdaS3ForcePathStyle() {
    const awsProvider = this.awsProvider;
    const patchMarker = path.join(
      awsProvider.serverless.serviceDir,
      '.serverless',
      '.internal-custom-resources-patched',
    );
    const zipFilePath = path.join(
      awsProvider.serverless.serviceDir,
      '.serverless',
      awsProvider.naming.getCustomResourcesArtifactName(),
    );

    function fileExists(filePath) {
      try {
        const stats = fs.statSync(filePath);
        return stats.isFile();
      } catch (e) {
        return false;
      }
    }

    function createPatchMarker() {
      try {
        fs.open(patchMarker, 'a').close();
      } catch (err) {
        return;
      }
    }
  
    function patchPreV3() {
      const utilFile = customResources.getEntry('utils.js');
      if (utilFile == null) return;
      const data = utilFile.getData().toString();
      const legacyPatch = 'AWS.config.s3ForcePathStyle = true;';
      if (data.includes(legacyPatch)) {
        createPatchMarker();
        return true;
      }
      const patchIndex = data.indexOf('AWS.config.logger = console;');
      if (patchIndex === -1) {
        return false;
      }
      const newData =
        data.slice(0, patchIndex) + legacyPatch + '\n' + data.slice(patchIndex);
      utilFile.setData(newData);
      return true;
    }

    function patchV3() {
      this.debug(
        'serverless-localstack: Patching V3',
      );
      const customResourcesBucketFile = customResources.getEntry('s3/lib/bucket.js');
      if (customResourcesBucketFile == null) {
        // TODO debugging, remove
        this.log(
          'serverless-localstack: Could not find file s3/lib/bucket.js to patch.',
        );
        return;
      }
      const data = customResourcesBucketFile.getData().toString();
      const oldClientCreation = 'S3Client({ maxAttempts: MAX_AWS_REQUEST_TRY });';
      const newClientCreation = 'S3Client({ maxAttempts: MAX_AWS_REQUEST_TRY, forcePathStyle: true });';
      if (data.includes(newClientCreation)) {
        // patch already done
        createPatchMarker();
        return;
      }
      const newData = data.replace(oldClientCreation, newClientCreation);
        
      customResourcesBucketFile.setData(newData);
    }

    if (fileExists(patchMarker)) {
      this.debug(
        'serverless-localstack: Serverless internal CustomResources already patched',
      );
      return;
    }

    const customResourceZipExists = fileExists(zipFilePath);

    if (!customResourceZipExists) {
      return;
    }

    const customResources = new AdmZip(zipFilePath);

    if (!patchPreV3.call(this)) {
      patchV3.call(this);
    }
    customResources.writeZip();
    createPatchMarker();
    this.debug(
      'serverless-localstack: Serverless internal CustomResources patched',
    );
  }
}

module.exports = LocalstackPlugin;
