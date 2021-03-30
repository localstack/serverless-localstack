const tempy = require('tempy');
const execSync = require('child_process').execSync;
const YAML = require('json2yaml');
const fs = require('fs-extra');
const path = require('path');
const serverlessExec = path.join(__dirname, '../../node_modules/.bin/serverless');
const packageJson = require('../../package.json')
const rimraf = require('rimraf')

const debug = false;

const defaultConfig = {
  service: 'aws-nodejs',
  provider: {
    name: 'aws',
    runtime: 'nodejs12.x',
    lambdaHashingVersion: '20201221'
  },
  plugins: [
    'serverless-localstack'
  ],
  custom: {
    localstack: {
      host: 'http://localhost',
      debug: debug,
    }
  },
  functions: {
    hello: {
      handler: 'handler.hello'
    }
  }
};

const installPlugin = (dir) => {
  const pluginsDir = path.join(dir, '.serverless_plugins');

  fs.mkdirsSync(pluginsDir);

  execSync(`npm link ${packageJson.name}`, {cwd: dir})
};

const execServerless = (arguments, dir) => {
  process.chdir(dir);

  execSync(`${serverlessExec} ${arguments}`, {
    stdio: 'inherit',
    stderr: 'inherit',
    env: Object.assign({}, process.env, {
      AWS_ACCESS_KEY_ID: 1234,
      AWS_SECRET_ACCESS_KEY: 1234,
      PATH: process.env.PATH,
      SLS_DEBUG: debug ? '*' : ''
    })
  });
};

exports.createService = (config, dir) => {
  dir = dir || tempy.directory();
  config = Object.assign({}, defaultConfig, config);

  execServerless('create --template aws-nodejs', dir);

  fs.writeFileSync(`${dir}/serverless.yml`, YAML.stringify(config));
  installPlugin(dir);

  return dir;
};

exports.deployService = (dir) => {
  execServerless('deploy', dir);
};

exports.removeService = (dir) => {
  rimraf.sync(dir)
};
