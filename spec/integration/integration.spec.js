'use strict';

const path = require('path');
const expect = require('chai').expect;
const services = require('../helpers/services');

const LONG_TIMEOUT = 30000;

describe('LocalstackPlugin', () => {

  it('should deploy a stack', () => {
    let service = services.createService({});
    services.deployService(service);
  }, LONG_TIMEOUT);

});
