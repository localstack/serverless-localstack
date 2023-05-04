'use strict';

const services = require('../helpers/services');

const LONG_TIMEOUT = 30000;
const AWS = require('aws-sdk');

// Set the region and endpoint in the config for LocalStack
AWS.config.update({
  region: 'us-east-1',
  endpoint: 'http://localhost:4566'
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
  Overwrite: true
};

describe('LocalstackPlugin', () => {

  beforeEach( () => {
    
    const self = this;
    // return promise here because ssm.putParameter is async
    return new Promise((resolve, reject) => {
      // create SSM parameter that will be used for the setup
      ssm.putParameter(params, function(err, data) { // eslint-disable-line
        if (err) {
          reject(err);
        } else {
          // if successful: create the actual service
          self.service = services.createService({});
          resolve(self.service);
        }
      });
    });
  });

  afterEach( () => {
    services.removeService(this.service);
  });

  it('should deploy a stack', () => {
    services.deployService(this.service);
  }, LONG_TIMEOUT);

});