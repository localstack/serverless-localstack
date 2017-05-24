const LocalstackPlugin = require('../../index');
const expect = require('chai').expect;
const sinon = require('sinon');
const AWS = require('aws-sdk');
const BbPromise = require('bluebird');


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
          this.instance = new LocalstackPlugin(this.serverless, {})
        });

        it('should not set the endpoint', ()=> {
          expect(this.instance.endpoint).to.be.undefined
        });

        it('should provide hooks', shouldProvideHooks)
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
    });

    describe('Config provided', () => {
      beforeEach(() => {
        this.serverless={
          service: {
            custom: {
              localstack: {
                endpoint: 'spec/support/localstack_endpoints.json',
              },
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


      it('should provide hooks', shouldProvideHooks)

      it('should set the endpoint', () => {
        expect(this.instance.endpoint).to.equal('spec/support/localstack_endpoints.json')
      });

    });
  })

  describe('"before:aws:deploy:deploy:createStack" hook', () => {
  //   let spawnStub;
  //   let spawnPackageStub;
  //
    beforeEach(() => {

      this.serverless={
        service: {
          custom: {
            localstack: {
              endpoint: 'spec/support/localstack_endpoints.json',
            },
          },
        },
        providers: {
          aws:{
            request: ()=>{}
          }
        }
      };
      this.instance = new LocalstackPlugin(this.serverless, {})

  //     spawnStub = sinon
  //     .stub(serverless.pluginManager, 'spawn');
  //     spawnPackageStub = spawnStub.withArgs('package').resolves();
      this.hook = this.instance.hooks["before:aws:deploy:deploy:createStack"]
    });
  //
  //   afterEach(() => {
  //     this.serverless.pluginManager.spawn.restore();
  //   });
  //
    it('should be defined', () => {
      expect(this.hook).not.to.be.undefined
    });

    it('should bind the provider request method', ()=> {
      var requestMethod = jasmine.createSpy('requestMethod')
      this.serverless={
        service: {
          custom: {
            localstack: {
              endpoint: 'spec/support/localstack_endpoints.json',
            },
          },
        },
        providers: {
          aws:{
            request: requestMethod
          }
        }
      };
      this.instance = new LocalstackPlugin(this.serverless, {})
      expect(this.instance.providerRequest).not.to.be.undefined
      this.instance.providerRequest()
      expect(requestMethod.calls.count()).to.equal(1)
    });

    it('should set the endpoint on the AWS provider when a provider request is invoked and the endpoint has been defined',(done)=> {
      this.awsRequest=new AWS.Lambda({apiVersion: '2015-03-31'})
      var requestMethod = () => { return new BbPromise((resolve, reject) => { resolve(this.awsRequest) }) }
      // var requestMethod = () => { return this.awsRequest }
      this.serverless={
        service: {
          custom: {
            localstack: {
              endpoint: 'spec/support/localstack_endpoints.json',
            },
          },
        },
        providers: {
          aws:{
            request: requestMethod
          }
        }
      };

      this.instance = new LocalstackPlugin(this.serverless, {})
      this.serverless.providers.aws.request('foo','bar','baz').then((result) => {
        expect(this.awsRequest.endpoint.href).to.equal('http://localhost:4574/')
        done()
      });

    });

  });
})
