'use strict';

const path = require('path');
const expect = require('chai').expect;
const Utils = require('./utils/index');
const uuid = require('uuid');

describe('Localstack - SNS: Existing topic with single function', () => {
  const snsTopic = uuid.v4();
  const snsEndpoint="http://localstack:4575"
  beforeAll(() => Utils.createSnsTopic(snsTopic,snsEndpoint)
    .then((result) => {
      process.env.EXISTING_TOPIC_ARN = result.TopicArn;
    })
    .then(() => {
      Utils.createTestService('aws-nodejs',
        path.join(__dirname, '..', 'support','service'));
      Utils.deployService();
    })
  );

  it('should trigger function when new message is published', () => Utils
    .publishSnsMessage(snsTopic, 'hello world')
    .delay(60000)
    .then(() => {
      const logs = Utils.getFunctionLogs('hello');
      expect(/aws:sns/g.test(logs)).to.equal(true);
      expect(/hello world/g.test(logs)).to.equal(true);
    })
  );

  afterAll(() => {
    Utils.removeService();
    Utils.removeSnsTopic(snsTopic);
  });
});
