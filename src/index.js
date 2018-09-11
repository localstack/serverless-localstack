'use strict';
const Promise = require('bluebird');
const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');
const util = require('util');

class LocalstackPlugin {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;

    this.commands = {
      deploy: {}
    };
    this.hooks = {
      'before:deploy:deploy': this.beforeDeploy.bind(this)
    };
    this.AWS_SERVICES = {
      'apigateway': 4567,
      'cloudformation': 4581,
      'cloudwatch': 4582,
      'lambda': 4574,
      'dynamodb': 4567,
      's3': 4572,
      'ses': 4579,
      'sns': 4575,
      'sqs': 4576
    };

    // Intercept Provider requests
    this.awsProvider = this.serverless.getProvider('aws');
    this.awsProviderRequest = this.awsProvider.request.bind(this.awsProvider);
    this.awsProvider.request = this.interceptRequest.bind(this);
    //this.reconfigureAWS();
  }

  beforeDeploy(){
    this.readConfig();
    this.getStageVariable();
    this.reconfigureAWS();
  }

  readConfig(){
    this.config = this.serverless.service.custom && this.serverless.service.custom.localstack || {};
    Object.assign(this.config, this.options);

    //Get the target deployment stage
    this.config.stage = ""
    this.config.options_stage = this.options.stage || undefined

    //If the target stage is listed in config.stages use the serverless-localstack-plugin
    //To keep default behavior if config.stages is undefined, then use serverless-localstack-plugin
    this.endpoints = this.config.endpoints || {};
    this.endpointFile = this.config.endpointFile;
    if (this.endpointFile) {
      this.loadEndpointsFromDisk(this.endpointFile);
    }
  }
  
  getStageVariable(){
    this.debug("config.options_stage: " + this.config.options_stage);
    this.debug("serverless.service.custom.stage: " + this.serverless.service.custom.stage);
    this.debug("serverless.service.provider.stage: " + this.serverless.service.provider.stage);
    this.config.stage = this.config.options_stage || this.serverless.service.custom.stage || this.serverless.service.provider.stage
  }

  reconfigureAWS() {
    if(this.config.stages === undefined || this.config.stages.indexOf(this.config.stage) > -1){
      this.log('Using serverless-localstack');
      const host = this.config.host;
      let configChanges = {};

      // If a host has been configured, override each service
      if (host) {
        for (const service of Object.keys(this.AWS_SERVICES)) {
          const port = this.AWS_SERVICES[service];
          const url = `${host}:${port}`;

          this.debug(`Reconfiguring service ${service} to use ${url}`);
          configChanges[service.toLowerCase()] = { endpoint: url };
        }
      }

      // Override specific endpoints if specified
      if (this.endpoints) {
        for (const service of Object.keys(this.endpoints)) {
          const url = this.endpoints[service];

          this.debug(`Reconfiguring service ${service} to use ${url}`);
          configChanges[service.toLowerCase()] = { endpoint: url };
        }
      }

      this.awsProvider.sdk.config.update(configChanges);
    }
    else {
      this.endpoints = {}
      this.log("Skipping serverless-localstack:\ncustom.localstack.stages: " +
        JSON.stringify(this.config.stages) +
        "\nstage: " +
        this.config.stage
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

  interceptRequest(service, method, params) {
    if (AWS.config[service.toLowerCase()]) {
      this.debug(`Using custom endpoint for ${service}: ${AWS.config.s3.endpoint}`);

      if (AWS.config['s3'] && params.TemplateURL) {
        this.debug(`Overriding S3 templateUrl to ${AWS.config.s3.endpoint}`);
        params.TemplateURL = params.TemplateURL.replace(/https:\/\/s3.amazonaws.com/, AWS.config['s3'].endpoint);
      }
    }

    return this.awsProviderRequest(service, method, params);
  }
}

module.exports = LocalstackPlugin;
