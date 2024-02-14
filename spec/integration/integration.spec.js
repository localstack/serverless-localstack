'use strict';

const services = require('../helpers/services');

const LONG_TIMEOUT = 30000;
const AWS = require('aws-sdk');

// Set the region and endpoint in the config for LocalStack
AWS.config.update({
  region: 'us-east-1',
  endpoint: 'http://127.0.0.1:4566',
});
AWS.config.credentials = new AWS.Credentials({
  accessKeyId: 'test',
  secretAccessKey: 'test',
});

const ssm = new AWS.SSM();

const params = {
  Name: '/dev/lambda/common/LAMBDA_STAGE',
  Type: 'String',
  Value: 'my-value',
  Overwrite: true,
};

describe('LocalstackPlugin', () => {
  beforeEach(async () => {
    await ssm.putParameter(params).promise();
    this.service = services.createService({});
  });

  afterEach(() => {
    services.removeService(this.service);
  });

  it(
    'should deploy a stack',
    () => {
      services.deployService(this.service);
    },
    LONG_TIMEOUT,
  );
});
