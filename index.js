'use strict';

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
    this.providerRequest = awsProvider.request.bind(awsProvider)
    awsProvider.request=this.interceptRequest.bind(this)
  }

  interceptRequest(service, method, params) {
    console.log(`intercepted request: (${service}, ${method}, ${params})`)
    // this.serverless.cli.log(`intercepted request: (${service}, ${method}, ${params})`)

    return this.providerRequest(service, method, params)
    .then( (result) => {
      result.setEndpoint('http://localhost:4574')
      return result
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
