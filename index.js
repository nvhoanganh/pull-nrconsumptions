const YOU_RPM_ACCOUNT = 00000; // this is where your customers usage stats are stored

/**
    To use this, just enter the list of accounts to sync in format: Name:RPM_Account:apiKey
     - Name: name of the account
     - RPM_Account: master account which contains NrConsumption data
     - apiKey: user api key to query the usage, make sure this api key can access the account above and can run this query

        FROM NrConsumption, NrMTDConsumption SELECT filter(sum(GigabytesIngested), WHERE productLine = 'DataPlatform' AND eventType() = 'NrConsumption') as 'GigabytesIngested', filter(latest(consumption), WHERE (metric = 'FullUsers' or metric = 'FullPlatformUsers') AND eventType() = 'NrMTDConsumption') AS 'FullUsers', filter(latest(CoreUsersBillable), WHERE productLine = 'FullStackObservability' AND eventType() = 'NrMTDConsumption') AS 'CoreUsers' SINCE 1 days ago

    You can run this query to see FSO changes
      FROM Metric SELECT latest(customermetric.value) where customermetric.accountName is NOT NULL and (customermetric.type ='FullUsers' or customermetric.type = 'FullPlatformUsers') facet customermetric.accountName TIMESERIES limit max

    You can run this query to see CoreUsers changes
      FROM Metric SELECT latest(customermetric.value) where customermetric.accountName is NOT NULL and customermetric.type ='CoreUsers' facet customermetric.accountName TIMESERIES limit max

    You can run this query to see CoreUsers changes
      FROM Metric SELECT latest(customermetric.value) where customermetric.accountName is NOT NULL and customermetric.type ='GigabytesIngested' facet customermetric.accountName TIMESERIES limit max
 */

const accounts = [
  'TestAccount:111111:NRAK-xxxxxxx',
]


// do not change anything after this line
let INSERT_KEY
const NAMESPACE = 'customermetric'
const DEFAULT_TIMEOUT = 5000

const IS_LOCAL_ENV = typeof $http === 'undefined';
if (typeof $http === 'undefined') {
  // only for local development
  console.log('running locally');
  var $http = require("request");

  var $secure = {};
  INSERT_KEY = 'NRII-Km-UTr1W9u7PAaX8vCU1atZOtztVJ4LX'
} else {
  // run in NR synthetic environment
  INSERT_KEY = $secure.YOUR_INSERT_KEY
}


const sendDataToNewRelic = async (data) => {
  let request = {
    url: "https://metric-api.newrelic.com/metric/v1",
    method: 'POST',
    headers: {
      "Api-Key": INSERT_KEY
    },
    json: data
  }
  return genericServiceCall([200, 202], request, (body, response, error) => {
    if (error) {
      console.log(`NR Post failed : ${error} `, true)
      return false
    } else {
      return response
    }
  })
}

const genericServiceCall = function (responseCodes, options, success) {
  !('timeout' in options) && (options.timeout = DEFAULT_TIMEOUT) //add a timeout if not already specified
  let possibleResponseCodes = responseCodes
  if (typeof (responseCodes) == 'number') { //convert to array if not supplied as array
    possibleResponseCodes = [responseCodes]
  }
  return new Promise((resolve, reject) => {
    $http(options, function callback(error, response, body) {
      if (error) {
        reject(`Connection error on url '${options.url}'`)
      } else {
        if (!possibleResponseCodes.includes(response.statusCode)) {
          let errmsg = `Expected [${possibleResponseCodes}] response code but got '${response.statusCode}' from url '${options.url}'`
          reject(errmsg)
        } else {
          resolve(success(body, response, error))
        }
      }
    });
  })
}

async function runNrQl(apiKey, query, accountId) {
  const graphQLQuery = `{
    actor {
      account(id: ${accountId}) {
        nrql(query: "${query}") {
          results
        }
      }
    }
  }
  `
  const options = {
    url: `https://api.newrelic.com/graphql`,
    method: 'POST',
    headers: {
      "Content-Type": "application/json",
      "API-Key": apiKey
    },
    json: {
      query: graphQLQuery
    }
  };
  const result = await genericServiceCall([200], options, (body) => { return body });
  return result;
}

async function pullUsageForCustomers(accounts) {
  let failed = 0;
  const query = `FROM NrConsumption, NrMTDConsumption SELECT filter(sum(GigabytesIngested), WHERE productLine = 'DataPlatform' AND eventType() = 'NrConsumption') as 'GigabytesIngested', filter(latest(consumption), WHERE (metric = 'FullUsers' or metric = 'FullPlatformUsers') AND eventType() = 'NrMTDConsumption') AS 'FullUsers', filter(latest(CoreUsersBillable), WHERE productLine = 'FullStackObservability' AND eventType() = 'NrMTDConsumption') AS 'CoreUsers' SINCE 1 days ago`;

  for (let index = 0; index < accounts.length; index++) {
    const accountName = accounts[index].split(':')[0];
    const accountId = accounts[index].split(':')[1];
    const apiKey = accounts[index].split(':')[2];

    console.log(`processing accountName: ${accountName}`);

    // step 2: run the NRQL above
    const queryResult = await runNrQl(apiKey, query, accountId);

    if (queryResult.error) {
      failed++;
      console.log(`failed to get Usage states for customer ${accountName}`, queryResult.error);
      continue;
    }

    // step 3: push to NRDB
    try {
      const usage = getMetricsData(queryResult, accountId, accountName);
      await sendDataToNewRelic([{
        metrics: usage
      }]);
    } catch (error) {
      failed++;
      console.log(`failed to get Usage states for customer ${accountName}`, error);
    }
  }

  // return the number of failed requests
  return failed;
}

function getMetricsData(data, accountId, accountName) {
  const result = Object.keys(data.data.actor.account.nrql.results[0])
    .map(key => ({
      name: `${NAMESPACE}.value`,
      type: "gauge",
      value: data.data.actor.account.nrql.results[0][key] || 0,
      timestamp: Math.round(Date.now() / 1000),
      attributes: {
        [`${NAMESPACE}.accountId`]: accountId,
        [`${NAMESPACE}.accountName`]: accountName,
        [`${NAMESPACE}.type`]: key
      }
    }));
  return result;
}

function getDaysElapsed(timestamp) {
  const diff = Date.now() - (new Date(timestamp)).getTime();
  var days = Math.ceil(diff / (1000 * 3600 * 24));
  return days;
}

// main
pullUsageForCustomers(accounts)
  .then(failedCount => {
    try {
      if (failedCount > 0) {
        assert.fail(`Failed to sync ${failedCount} accounts`)
      } else {
        assert.ok('All accounts synced')
      }
      console.log(`done, number of failed accounts: ${failedCount}`)
    } catch (error) {
      console.log(`local run done, number of failed accounts: ${failedCount}`)
      // locally, there is no assert
    }
  });