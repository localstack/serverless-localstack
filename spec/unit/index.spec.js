'use strict';
const LocalstackPlugin = require('../../src/index');
const chai = require('chai');
const expect = require('chai').expect;
const sinon = require('sinon');
const AWS = require('aws-sdk');
const Serverless = require('serverless')
let AwsProvider;
try {
  AwsProvider = require('serverless/lib/plugins/aws/provider/awsProvider');
} catch (e) {
  AwsProvider = require('serverless/lib/plugins/aws/provider');
}

chai.use(require('chai-string'));

// Enable for more verbose logging
const debug = false;

describe("LocalstackPlugin", () => {

  let serverless;
  let awsProvider;
  let awsConfig;
  let instance;
  let sandbox;
  let defaultPluginState = {};
  let config = {
    host: 'http://localhost',
    debug: debug
  };

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    serverless = new Serverless();
    awsProvider = new AwsProvider(serverless, {});
    awsConfig = new AWS.Config();
    AWS.config = awsConfig;
    awsProvider.sdk = AWS;
    awsProvider.config = awsConfig;
    serverless.init();
    serverless.setProvider('aws', awsProvider);
    if (serverless.cli) {
      serverless.cli.log = () => {
        if (debug) {
          console.log.apply(this, arguments);  // eslint-disable-line no-console
        }
      }
    }
  });

  afterEach(() => {
    sandbox.restore();
  });

  let simulateBeforeDeployHooks = function(instance) {
    instance.readConfig();
    instance.activatePlugin();
    instance.getStageVariable();
    instance.reconfigureAWS();
  };

  describe('#constructor()', () => {
    describe('with empty configuration', () => {
      beforeEach(() => {
        serverless.service.custom = {};
        instance = new LocalstackPlugin(serverless, defaultPluginState);
        simulateBeforeDeployHooks(instance)
      });

      it('should not set the endpoints', () => {
        expect(instance.endpoints).to.be.empty;
      });

      it('should not set the endpoint file', () => {
        expect(instance.endpointFile).to.be.undefined;
      });
    });

    describe('with config file provided', () => {
      beforeEach(() => {
        serverless.service.custom = {
          localstack: {}
        };
        instance = new LocalstackPlugin(serverless, defaultPluginState);
        simulateBeforeDeployHooks(instance);
      });

      it('should not set the endpoints if the stages config option does not include the deployment stage', () => {
          serverless.service.custom.localstack.stages = ['production'];

          let plugin = new LocalstackPlugin(serverless, defaultPluginState);
          simulateBeforeDeployHooks(plugin);
          expect(plugin.endpoints).to.be.empty;
      });

      it('should set the endpoints if the stages config option includes the deployment stage', () => {
        serverless.service.custom.localstack.stages = ['production', 'staging'];

        let plugin = new LocalstackPlugin(serverless, {'stage':'production'})
        simulateBeforeDeployHooks(plugin);

        expect(plugin.config.stages).to.deep.equal(['production','staging']);
        expect(plugin.config.stage).to.equal('production');
      });

      it('should fail if the endpoint file does not exist and the stages config option includes the deployment stage', () => {
        serverless.service.custom.localstack = {
          endpointFile: 'missing.json',
          stages: ['production']
        }

        let plugin = () => {
          let pluginInstance = new LocalstackPlugin(serverless, {'stage':'production'});
          pluginInstance.readConfig();
        }

        expect(plugin).to.throw('Endpoint file "missing.json" is invalid:')
      });

      it('should not fail if the endpoint file does not exist when the stages config option does not include the deployment stage', () => {
        serverless.service.custom.localstack = {
          endpointFile: 'missing.json',
          stages: ['production']
        }

        let plugin = () => {
          let pluginInstance = new LocalstackPlugin(serverless, {'stage':'staging'});
          pluginInstance.readConfig();
        }

        expect(plugin).to.not.throw('Endpoint file "missing.json" is invalid:')
      });

      it('should fail if the endpoint file is not json', () => {
        serverless.service.custom.localstack = {
          endpointFile: 'README.md'
        }
        let plugin = () => {
          let pluginInstance = new LocalstackPlugin(serverless, defaultPluginState);
          pluginInstance.readConfig();
        }
        expect(plugin).to.throw(/Endpoint file "README.md" is invalid:/)
      });

    });
  });

  describe('#request() bound on AWS provider', () => {

    beforeEach(()=> {
      class FakeService {
        foo() {
          return this;
        }

        send() {
          return this;
        }
      }

      serverless.providers.aws.sdk.S3 = FakeService;
      serverless.service.custom = {
        localstack: {}
      }
    });

    it('should overwrite the S3 hostname', () => {
      const pathToTemplate = 'https://s3.amazonaws.com/path/to/template';
      const request = sinon.stub(awsProvider, 'request');
      instance = new LocalstackPlugin(serverless, defaultPluginState)
      simulateBeforeDeployHooks(instance);

      awsProvider.request('s3', 'foo', {
        TemplateURL: pathToTemplate
      });
      expect(request.called).to.be.true;
      let templateUrl = request.firstCall.args[2].TemplateURL;
      expect(templateUrl).to.startsWith(`${config.host}`);
    });

    it('should not send validateTemplate calls to localstack', () => {
      const request = sinon.stub(awsProvider, 'request');
      instance = new LocalstackPlugin(serverless, defaultPluginState)
      simulateBeforeDeployHooks(instance);

      awsProvider.request('S3', 'validateTemplate', {});

      expect(request.called).to.be.false;
    });

  });

})
