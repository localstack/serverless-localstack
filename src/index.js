'use strict';
const BbPromise = require('bluebird');
const AWS = require('aws-sdk');
const fs = require('fs')


class LocalstackPlugin {
  constructor(serverless, options) {
    this.serverless = serverless;
    var customConfig = this.serverless.service.custom || {}
    var pluginConfig= customConfig.localstack || {}
    this.options = options;
    this.endpoint = pluginConfig.endpoint
    this.commands = {
      deploy: {

      },
    };

    this.hooks = {
    };

    // Intercept Provider requests
    const awsProvider=this.serverless.providers.aws

    if( this.endpoint && awsProvider.options) {
      if (!fs.existsSync(this.endpoint)){
        throw new ReferenceError(`Endpoint: "${this.endpoint}" could not be found.`)
      }

      let endpointJson;
      try{
        endpointJson=require(this.endpoint.substring(0,this.endpoint.indexOf('.json')))
      }catch(err) {
        throw new ReferenceError(`Endpoint: "${this.endpoint}" is invalid: ${err}`)
      }
      awsProvider.options.serverless_localstack= {
        endpoints: endpointJson
      }
    }
    this.providerRequest = awsProvider.request.bind(awsProvider)
    awsProvider.request=this.interceptRequest.bind(awsProvider)

    // this.providerGetCredentials = awsProvider.getCredentials.bind(awsProvider)
    // awsProvider.getCredentials=this.interceptGetCredentials.bind(this)
  }

  // interceptGetCredentials(){
  //   credentials = this.providerGetCredentials()
  //
  //   if(this.endpoint){
  //     const endpointJson = this.endpoint
  //     if(endpointJson[service]){
  //
  //       this.serverless.cli.log(`Using custom endpoint for ${service}: ${endpointJson[service]}`)
  //       awsService.setEndpoint(endpointJson[service])
  //      FIXME - DONT HAVE ACCESS TO THE SERVICE...
  //     }
  //   }
  // }


  interceptRequest(service, method, params) {
    const that = this;
    const credentials = that.getCredentials();


    this.serverless.cli.log(`Using serverless-localstack plugin`)

    if(this.options.serverless_localstack && this.options.serverless_localstack.endpoints){
      const endpointJson = this.options.serverless_localstack.endpoints
      if(endpointJson[service]){

        this.serverless.cli.log(`Using custom endpoint for ${service}: ${endpointJson[service]}`)
        credentials.endpoint = endpointJson[service]
      }
    }

    const persistentRequest = (f) => new BbPromise((resolve, reject) => {
      const doCall = () => {
        f()
          .then(resolve)
          .catch((e) => {
            if (e.statusCode === 429) {
              that.serverless.cli.log("'Too many requests' received, sleeping 5 seconds");
              setTimeout(doCall, 5000);
            } else {
              reject(e);
            }
          });
      };
      return doCall();
    });

    return persistentRequest(() => {
      const awsService = new that.sdk[service](credentials);

      // if(this.options.serverless_localstack && this.options.serverless_localstack.endpoints){
      //   const endpointJson = this.options.serverless_localstack.endpoints
      //   if(endpointJson[service]){
      //
      //     this.serverless.cli.log(`Using custom endpoint for ${service}: ${endpointJson[service]}`)
      //     awsService.setEndpoint(endpointJson[service])
      //   }
      // }


      const req = awsService[method](params);

      // TODO: Add listeners, put Debug statments here...
      // req.on('send', function (r) {console.log(r)});

      return new BbPromise((resolve, reject) => {
        req.send((errParam, data) => {
          const err = errParam;
          if (err) {
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
      });
    });

  }

}

module.exports = LocalstackPlugin;
