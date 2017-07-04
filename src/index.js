'use strict';
const Promise = require('bluebird');
const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');

class LocalstackPlugin {
  constructor(serverless, options) {
    this.config = serverless.service.custom && serverless.service.custom.localstack || {};
    this.serverless = serverless;
    this.options = options;
    this.endpoints = this.config.endpoints || {};
    this.endpointFile = this.config.endpointFile;
    this.commands = {
      deploy: {}
    };
    this.hooks = {
    };

    this.log('Using serverless-localstack-plugin');

    if (this.endpointFile) {
      this.loadEndpointsFromDisk(this.endpointFile);
    }

    // Intercept Provider requests
    this.awsProvider = this.serverless.providers.aws;
    this.awsProviderRequest = this.awsProvider.request.bind(this.awsProvider);
    this.awsProvider.request = this.interceptRequest.bind(this);
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
    const credentials = (function() {
      return this.getCredentials();
    }).bind(this.awsProvider);

    const endpoints = this.endpoints;

    if (!endpoints || !endpoints[service]) {
      this.debug(`Not intercepting ${service}`);
      return this.awsProviderRequest(service, method, params);
    }

    const endpoint = endpoints[service];

    // // Template validation is not supported in LocalStack
    if (method == "validateTemplate") {
      return Promise.resolve("");
    }

    if (endpoints['S3'] && params.TemplateURL) {
      params.TemplateURL = params.TemplateURL.replace(/https:\/\/s3.amazonaws.com/, endpoints['S3']);
    }

    this.debug(`Using custom endpoint for ${service}: ${endpoint}`);
    credentials.endpoint = endpoint;

    return new Promise((resolve, reject) => {
      const awsService = new this.awsProvider.sdk[service](credentials);
      const req = awsService[method](params);
      let retries = 0;

      // // TODO: Add listeners, put Debug statments here...
      if (this.config.verbose) {
        req.on('send', (req) => {
          const request = req.request.httpRequest;
          this.debug('Send: ' + request.method + ' ' + request.path + "\n" + request.body);
        });
        req.on('success', (res) => {
          this.debug('Receive: ' + res.httpResponse.body.toString());
        });
      }

      const send = () => {
        req.send((errParam, data) => {
          const err = errParam;
          if (err) {
            if (err.statusCode === 429 && retries < 3) {
              this.debug("'Too many requests' received, sleeping 5 seconds");
              retries ++;
              return setTimeout(send().bind(this), 5000);
            }

            if (err.message === 'Missing credentials in config') {
              const errorMessage = [
                'AWS provider credentials not found.',
                ' You can find more info on how to set up provider',
                ' credentials in our docs here: https://git.io/vXsdd',
              ].join('');
              err.message = errorMessage;
            }

            reject(new this.serverless.classes.Error(err.message, err.statusCode));
          } else {
            resolve(data);
          }
        });
      };

      send();
    });
  }
}

module.exports = LocalstackPlugin;
