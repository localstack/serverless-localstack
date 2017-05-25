const LocalstackPlugin = require('../../index');
const expect = require('chai').expect;
const sinon = require('sinon');
const AWS = require('aws-sdk');
const BbPromise = require('bluebird');
const Serverless = require('serverless')
const AwsProvider = require('serverless/lib/plugins/aws/provider/awsProvider')

describe("LocalstackPlugin", () => {



  describe('#constructor()', () => {

    shouldProvideHooks = ()=>{
      expect(this.instance.hooks).not.to.be.undefined
    }

    describe('Config missing', () => {
        beforeEach(() => {
          this.serverless={
            service: {
            },
            providers: {
              aws:{
                request: ()=>{}
              }
            }
          };
        });

        it('should not set the endpoint', ()=> {
          this.instance = new LocalstackPlugin(this.serverless, {})
          expect(this.instance.endpoint).to.be.undefined
        });

        it('should provide hooks', () =>{
          this.instance = new LocalstackPlugin(this.serverless, {})
          expect(shouldProvideHooks()).to.not.throw
        });

    });
    describe('Config empty', () => {
        beforeEach(() => {
          this.serverless={
            service: {
              custom: {
              },
            },
            providers: {
              aws:{
                options: {},
                request: ()=>{}
              }
            }
          };
          this.instance = new LocalstackPlugin(this.serverless, {})
        });

        it('should not set the endpoint', ()=> {
          expect(this.instance.endpoint).to.be.undefined
        });

        it('should provide hooks', shouldProvideHooks)

        it('should not set the endpoints on the AWS provider when endpoints not defined', ()=> {
          expect(this.instance.serverless.providers.aws.options.serverless_localstack).to.be.undefined
        })

        it('should fail if the endpoint file does not exist', () => {
          this.serverless.service.custom.localstack={
            endpoint: 'missing.json'
          }
          plugin = () => { new LocalstackPlugin(this.serverless, {}) }
          expect(plugin).to.throw('Endpoint: "missing.json" could not be found.')
        });

        it('should fail if the endpoint file is not json', () => {
          this.serverless.service.custom.localstack={
            endpoint: 'README.md'
          }
          plugin = () => { new LocalstackPlugin(this.serverless, {}) }
          expect(plugin).to.throw(/Endpoint: "README.md" is invalid./)

        })
    });
    describe('Config empty', () => {
        beforeEach(() => {
          this.serverless={
            service: {
              custom: {
                localstack: {}
              },
            },
            providers: {
              aws:{
                request: ()=>{}
              }
            }
          };
          this.instance = new LocalstackPlugin(this.serverless, {})
        });

        it('should not set the endpoint', ()=> {
          expect(this.instance.endpoint).to.be.undefined
        });

        it('should provide hooks', shouldProvideHooks)

        it('should not set the endpoints on the AWS provider when provider options not defined', ()=> {
          expect(this.instance.serverless.providers.aws.options).to.be.undefined
        })
    });

    describe('Config provided', () => {
      beforeEach(() => {
        this.serverless={
          service: {
            custom: {
              localstack: {
                endpoint: './example/localstack_endpoints.json',
              },
            },
          },
          providers: {
            aws:{
              options: {},
              request: ()=>{}
            }
          }
        };
        this.instance = new LocalstackPlugin(this.serverless, {})
      });


      it('should provide hooks', shouldProvideHooks)

      it('should set the endpoint', () => {
        expect(this.instance.endpoint).to.equal('./example/localstack_endpoints.json')
      });

      it('should copy the endpoints to the AWS provider options', ()=> {
        endpoints=require('../../example/localstack_endpoints')

        expect(this.instance.serverless.providers.aws.options.serverless_localstack.endpoints).to.deep.equal(endpoints)
      })

    });
  })

  describe('"before:aws:deploy:deploy:createStack" hook', () => {
    beforeEach(() => {

      this.serverless={
        service: {
          custom: {
            localstack: {
              endpoint: './example/localstack_endpoints.json',
            },
          },
        },
        providers: {
          aws:{
            options: {},
            request: ()=>{}
          }
        }
      };
      this.instance = new LocalstackPlugin(this.serverless, {})

      this.hook = this.instance.hooks["before:aws:deploy:deploy:createStack"]
    });

    it('should be defined', () => {
      expect(this.hook).not.to.be.undefined
    });

    it('should bind the provider request method', ()=> {
      var requestMethod = jasmine.createSpy('requestMethod')
      this.serverless={
        service: {
          custom: {
            localstack: {
              endpoint: './example/localstack_endpoints.json',
            },
          },
        },
        providers: {
          aws:{
            options: {},
            request: requestMethod
          }
        }
      };
      this.instance = new LocalstackPlugin(this.serverless, {})
      expect(this.instance.providerRequest).not.to.be.undefined
      this.instance.providerRequest()
      expect(requestMethod.calls.count()).to.equal(1)
    });

    describe('#request() bound on AWS provider', ()=>{

      beforeEach(()=> {
        var that=this;
        class FakeService {
          constructor(credentials) {
            this.credentials = credentials;
          }

          setEndpoint(endpoint){
            that.endpoint=endpoint
          }

          foo(){
            return this;
          }

          send(){
            return this;
          }
        }
        this.FakeService = FakeService
        const options={}
        this.serverless = new Serverless(options);
        this.serverless.service.custom = {
          localstack: {
            endpoint: './example/localstack_endpoints.json',
          },
        }

        this.serverlessAwsProvider = new AwsProvider(this.serverless, {})
        this.serverless.providers.aws=this.serverlessAwsProvider

      });

      it('should set the endpoint on the AWS provider when a provider request is invoked and the endpoint has been defined',
      (done)=> {
        this.serverlessAwsProvider.sdk = {
          Lambda: this.FakeService,
        };

        this.instance = new LocalstackPlugin(this.serverless, {})

        this.serverless.providers.aws.request('Lambda','foo',{});

        expect(this.endpoint).to.equal('http://localstack:4574')
        done()
      });

      it('should not set the endpoint if the required endpoint service is not defined', (done) => {
        this.serverlessAwsProvider.sdk = {
          Lambda: this.FakeService,
          bobbins: this.FakeService,
        };

        this.instance = new LocalstackPlugin(this.serverless, {})

        this.serverless.providers.aws.request('bobbins','foo',{});

        expect(this.endpoint).to.be.undefined
        done()
      });

    });

    afterEach(()=>{
      this.endpoint=undefined
    })

  });
})
