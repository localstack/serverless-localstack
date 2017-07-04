'use strict';
const LocalstackPlugin = require('../../src/index');
const expect = require('chai').expect;
const sinon = require('sinon');
const fs = require('fs')
const AWS = require('aws-sdk');
const BbPromise = require('bluebird');
const Serverless = require('serverless')
const AwsProvider = require('serverless/lib/plugins/aws/provider/awsProvider')
const path = require('path');
const localstackEndpointsFile = path.normalize( path.join(__dirname, '../../example/service/localstack_endpoints.json') );

const debug = false;

describe("LocalstackPlugin", () => {

  let serverless;
  let instance;

  beforeEach(() => {
    serverless = {
      cli: {
        log: (msg) => {
          if (debug) {
            console.log(msg)
          }
        }
      },
      service: {
        custom: {
          localstack: {
            debug: debug,
            endpoints: {
              'S3': 'http://localhost:4572'
            }
          }
        }
      },
      providers: {
        aws: {
          request: () => {},
          setProvider: () => {}
        }
      }
    };
  });

  describe('#constructor()', () => {

    describe('Config missing', () => {

        beforeEach(() => {
          serverless.service.custom = null;
          instance = new LocalstackPlugin(serverless, {});
        });

        it('should not set the endpoint', () => {
          expect(instance.endpoints).to.be.empty;
        });

    });
    describe('Config empty', () => {

        it('should not set the endpoint', ()=> {
          serverless.service.custom.localstack = {};
          instance = new LocalstackPlugin(serverless, {})

          expect(instance.endpoints).to.be.empty;
          expect(instance.hooks).to.be.empty;
        });

        it('should fail if the endpoint file does not exist', () => {
          serverless.service.custom.localstack = {
            endpointFile: 'missing.json'
          }
          let plugin = () => { new LocalstackPlugin(serverless, {}) }
          expect(plugin).to.throw('Endpoint: "missing.json" is invalid:')
        });

        it('should fail if the endpoint file is not json', () => {
          serverless.service.custom.localstack = {
            endpointFile: 'README.md'
          }
          let plugin = () => { new LocalstackPlugin(serverless, {}) }
          expect(plugin).to.throw(/Endpoint: "README.md" is invalid:/)

        })
    });

    describe('Config provided', () => {
      beforeEach(() => {
        serverless.service.custom.localstack.endpointFile = localstackEndpointsFile;
        instance = new LocalstackPlugin(serverless, {})
      });

      it('should set the endpoint file', () => {
        expect(instance.endpointFile).to.equal(localstackEndpointsFile)
      });

      it('should copy the endpoints to the AWS provider options', ()=> {
        let endpoints = JSON.parse(fs.readFileSync(localstackEndpointsFile))

        expect(instance.endpoints).to.deep.equal(endpoints)
      })

    });
  });

  describe('#request() bound on AWS provider', ()=>{

    beforeEach(()=> {
      var that=this;
      class FakeService {
        constructor(credentials) {
          that.credentials = credentials;
        }

        foo() {
          return this;
        }

        send(){
          return this;
        }
      }
      this.FakeService = FakeService
      const options = {}
      serverless = new Serverless(options);
      serverless.cli = {
        log: (msg) => {
          if (debug) {
            console.log(msg)
          }
        }
      }

      serverless.service.custom = {
        localstack: {
          endpointFile: localstackEndpointsFile,
        }
      }

      this.serverlessAwsProvider = new AwsProvider(serverless, {})
      serverless.providers.aws=this.serverlessAwsProvider

    });

    it('should set the endpoint on the AWS provider when a provider request is invoked and the endpoint has been defined',
    (done)=> {
      this.serverlessAwsProvider.sdk = {
        Lambda: this.FakeService,
      };

      instance = new LocalstackPlugin(serverless, {})

      serverless.providers.aws.request('Lambda','foo',{});

      expect(this.credentials.endpoint).to.equal('http://localstack:4574')
      done()
    });

    it('should not set the endpoint if the required endpoint service is not defined', (done) => {
      this.serverlessAwsProvider.sdk = {
        Lambda: this.FakeService,
        bobbins: this.FakeService,
      };

      instance = new LocalstackPlugin(serverless, {})

      serverless.providers.aws.request('bobbins','foo',{}).then((result) => {
        expect(result).to.be.true;
      });

      done()
    });

  });

})
