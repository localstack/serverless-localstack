'use strict';

const services = require('../helpers/services');

const LONG_TIMEOUT = 30000;

describe('LocalstackPlugin', () => {

  beforeEach( () => {
    this.service = services.createService({});
  });

  afterEach( () => {
    services.removeService(this.service);
  });

  it('should deploy a stack', () => {
    services.deployService(this.service);
  }, LONG_TIMEOUT);

});
