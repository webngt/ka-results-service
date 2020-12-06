const stringify = require('csv-stringify');
const fetch = require('node-fetch');
const fs = require('fs');

const express = require('express');
const app = express();


const jwktopem = require('jwk-to-pem');
const jwt = require('jsonwebtoken');

const config = JSON.parse(fs.readFileSync('config/config.json'));

// cloud native healthchecks
const health = require('@cloudnative/health-connect');
let healthcheck = new health.HealthChecker();

const shutdownPromise = () => new Promise(function (resolve, _reject) {
    setTimeout(function () {
      console.log('DONE!');
      resolve();
    }, 10);
  });
let shutdownCheck = new health.ShutdownCheck("shutdownCheck", shutdownPromise);

healthcheck.registerShutdownCheck(shutdownCheck);
app.use('/live', health.LivenessEndpoint(healthcheck));
app.use('/ready', health.ReadinessEndpoint(healthcheck));

app.use(express.json());


// simple in memory storage
// const example = {
//     user_id: 'test_user',
//     timestamp: 122233453345,
//     data: {
//         allow: [],
//         deny: [],
//         err: [],
//         task_id: 'test_task'
//     }
// };

const storage = [];

async function table_to_csv(table) {
    return new Promise((resolve, reject) => {
        stringify(table, function(err, output){
            if (err !== undefined && err !== null) {
                reject(err);
            } else {
                resolve(output);
            }
        });
    });
}

async function csv() {
    const table = [['timestamp', 'user_id', 'task_id', 'status']];
    storage.forEach(item => table.push([
        item.timestamp, 
        item.user_id, 
        item.data.task_id, 
        item.data.deny.length == 0 ? 'OK' : 'FAIL'
    ])); 
    return await table_to_csv(table);
}

function save(user_id, data) {
    const timestamp = Date.now();
    console.log(data.task_id)
    storage.push({user_id, timestamp, data});
}


async function authorize(req) {
    const auth = req.get('Authorization');
    if (auth === undefined) {
        console.log('authorization falied: no Authorization header set');
        return {
            statusCode: 401
        };
    } 
    const parts = auth.split(" ");
    if (parts.length != 2) {
        console.log(`authorization falied: parts=${parts}`);
        return {
            statusCode: 401
        };
    }
    try {
        const response = await fetch(config.checklistIss);
        const jwks = await response.json();
        const [ firstKey ] = jwks.keys;
        const publicKey = jwktopem(firstKey)

        const decoded = jwt.verify(parts[1], publicKey);
        return {
            decoded,
            statusCode: 200
        };
    } catch (err) {
        console.log(`authorization falied: ${err}`);
        return {
            statusCode: 401
        };
    }    
}

app.post('/save', async function (req, res) {
    const auth = await authorize(req);
    if (auth.statusCode !== 200) {
        res.status(auth.statusCode).end();
        return;
    }
    save(auth.decoded.sub, req.body);
    res.end();
});


app.get('/report', async function (req, res) {
    res.set('Content-Type', 'text/plain');
    res.send(await csv());
    res.end();
});


async function checkDB() {
    throw new Error('not implemented');
}

// each check returns a Promise


app.listen(3000);    
