'use strict';
const Promise=require("bluebird");
const expect = require('chai').expect;
const testUtils = require('./index');
var request = require('request-promise');
const uuid = require('uuid');
const path = require('path');

describe('Test utils', () => {
  describe('#getTmpDirPath()', () => {
    it('should return a valid tmpDir path', () => {
      const tmpDirPath = testUtils.getTmpDirPath();

      expect(tmpDirPath).to.match(/.+.{16}/);
    });
  });

  describe('#getTmpFilePath()', () => {
    it('should return a valid tmpFile path', () => {
      const fileName = 'foo.bar';
      const tmpFilePath = testUtils.getTmpFilePath(fileName);

      expect(tmpFilePath).to.match(/.+.{16}.{1}foo\.bar/);
    });
  });

  describe('#createTestService()', () => {
    it('should copy the localstack_endpoints.json', ()=> {
      fail('TODO')
    });
  });

  describe('Localstack Support', ()=> {

    const snsEndpoint="http://localstack:4575"
    describe('SNS', () => {
      beforeEach((done) => {
        this.snsTopic = uuid.v4();
        testUtils.createSnsTopic(this.snsTopic,snsEndpoint).then((result)=>{
          process.env.EXISTING_TOPIC_ARN = result.TopicArn;
          expect(result.TopicArn).to.be.defined
          done()
        });
      });

      describe('#createSnsTopic()', ()=> {


        it('should create a local SNS topic', (done) => {
          request(snsEndpoint + '/?Action=ListTopics')
          .then((output) => {
            expect(output).to.have.string(this.snsTopic)
            done()
          })
          .catch((e) => {
            done(e)
          });

        });
        afterEach((done) =>{
          testUtils.removeSnsTopic(this.snsTopic,snsEndpoint).finally(done);
        });

      });

      describe('#removeSnsTopic()', ()=> {

        it('should delete an existing a local SNS topic', (done) => {
          testUtils.removeSnsTopic(this.snsTopic,snsEndpoint).then( ()=> {
            return request(snsEndpoint+'/?Action=ListTopics')
          })
          .then((output) => {
            expect(output).not.to.have.string(this.snsTopic)
            done()
          })
          .catch((e) => {
            done(e)
          })
        });

        describe('#publishSnsMessage()', ()=>{
          it('should publish to the local SNS Topic', (done) => {
            testUtils.publishSnsMessage(this.snsTopic,'Hello World',snsEndpoint)
            .then((response) => {
              expect(response.MessageId).to.be.defined
              done()
            })
            .catch((e) => {
              done(e)
            })
          });
        });
      });
    });

    describe("Lambda", () => {
      // TODO require
      const lambdaEndpoint='http://localstack:4574';
      const endpoint=path.join(__dirname, 'localstack_endpoints.json')
      beforeAll((done) => {
        // this.timeout(5000);
        testUtils.createTestService('aws-nodejs', path.join(__dirname, '../support/service'));
        done()
      });

      describe("#deployService()", ()=> {
        it("should create a local function", ()=> {
          testUtils.deployService()
          .then( (response) => {
            return request(lambdaEndpoint + '/2015-03-31/functions/')
          })
          .then( (response) => {
              expect(response).to.have.string('hello')
          })
          .catch((e) => {
            done(e)
          });
        });
      });

      afterAll(() => {
        testUtils.removeService();
      });
    });

  });
});
