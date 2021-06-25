'use strict';
//hi i go to do changes in this proyect XD

var num = 2-2;
console.log(num)
//already XD................

module.exports.hello = (event, context, callback) => {
  process.stdout.write(event.Records[0].EventSource);
  process.stdout.write(event.Records[0].Sns.Message);
  callback(null, { message: 'Hello from SNS!', event });
};
