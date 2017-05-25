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
      welcome: {
        usage: 'Helps you start your first Serverless plugin',
        lifecycleEvents: [
          'hello',
          'world',
        ],
        options: {
          message: {
            usage:
              'Specify the message you want to deploy '
              + '(e.g. "--message \'My Message\'" or "-m \'My Message\'")',
            required: true,
            shortcut: 'm',
          },
        },
      },
    };

    this.hooks = {
      'before:aws:deploy:deploy:createStack': this.beforeCreateStack.bind(this),
      'before:welcome:hello': this.beforeWelcome.bind(this),
      'welcome:hello': this.welcomeUser.bind(this),
      'welcome:world': this.displayHelloMessage.bind(this),
      'after:welcome:world': this.afterHelloWorld.bind(this),
    };

    // console.log(this.serverless)
    // console.log(this.serverless.service.provider.request)
    // console.log(this.serverless.providers.aws.request)

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
  }

  // interceptRequest(service, method, params) {
  //   console.log(`intercepted request: (${service}, ${method}, ${params})`)
  //   // this.serverless.cli.log(`intercepted request: (${service}, ${method}, ${params})`)
  //
  //   return this.providerRequest(service, method, params)
  //   .then( (result) => {
  //     result.setEndpoint('http://localhost:4574')
  //     return result
  //   });
  //
  // }

  interceptRequest(service, method, params) {
    console.log(`intercepted request: (${service}, ${method}, ${params})`)
    // this.serverless.cli.log(`intercepted request: (${service}, ${method}, ${params})`)

    // return request(service, method, params)
    const that = this;
    const credentials = that.getCredentials();
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

      if(this.options.serverless_localstack && this.options.serverless_localstack.endpoints){
        const endpointJson = this.options.serverless_localstack.endpoints
        if(endpointJson[service]){

          console.log('endpoint injected...')
          awsService.setEndpoint(endpointJson[service])
        }
      }


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

  beforeCreateStack(){

  }

  beforeWelcome() {
    this.serverless.cli.log('Hello from Serverless!');
  }

  welcomeUser() {
    this.serverless.cli.log('Your message:');
  }

  displayHelloMessage() {
    this.serverless.cli.log(`${this.options.message}`);
  }

  afterHelloWorld() {
    this.serverless.cli.log('Please come again!');
  }
}

module.exports = LocalstackPlugin;
