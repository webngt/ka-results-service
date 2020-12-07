const stringify = require('csv-stringify');
const fetch = require('node-fetch');
const fs = require('fs');
const { Sequelize, DataTypes } = require('sequelize');

const express = require('express');
const app = express();


const jwktopem = require('jwk-to-pem');
const jwt = require('jsonwebtoken');

const config = JSON.parse(fs.readFileSync('config/config.json'));
const secrets = JSON.parse(fs.readFileSync('secrets/secrets.json'));

const sequelize = new Sequelize(secrets.db_url);

// cloud native healthchecks
const health = require('@cloudnative/health-connect');
let healthcheck = new health.HealthChecker();

const Result = sequelize.define('Result', {
    // Model attributes are defined here
    user_id: {
      type: DataTypes.STRING,
      allowNull: false
    },
    data: {
      type: DataTypes.JSON,
      allowNull: false
      // allowNull defaults to true
    },

  }, {
    // Other model options go here
});

const dbPromise = () => new Promise(async function (resolve, _reject) {
    try {
        await sequelize.authenticate();
        console.log('DB connection alive.');
        resolve();
    } catch (error) {
        console.error('Unable to connect to the database:', error);
        _reject(error);
    }
});

let readyCheck = new health.ReadinessCheck("dbCheck", dbPromise);//health.LivenessCheck("liveCheck", livePromise);
healthcheck.registerReadinessCheck(readyCheck);
healthcheck.registerLivenessCheck(readyCheck);


const shutdownPromise = () => new Promise(async function (resolve, _reject) {
    try {
        await sequelize.close();
        console.log('DB connection has been closed.');
        resolve();
    } catch (error) {
        console.error('Unable to close the database:', error);
        _reject(error);
    }
});

let shutdownCheck = new health.ShutdownCheck("shutdownCheck", shutdownPromise);

healthcheck.registerShutdownCheck(shutdownCheck);
app.use('/live', health.LivenessEndpoint(healthcheck));
app.use('/ready', health.ReadinessEndpoint(healthcheck));

app.use(express.json());

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
    await Result.sync();
    const results = await Result.findAll();
    results.every(item => table.push([
        item.createdAt, 
        item.user_id, 
        item.data.task_id, 
        item.data.deny.length == 0 ? 'OK' : 'FAIL'
    ]));
    return await table_to_csv(table);
}

async function save(user_id, data) {
    console.log(data.task_id);
    await Result.sync();
    await Result.create({ user_id, data});

    //storage.push({user_id, timestamp, data});
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
    try {
        const auth = await authorize(req);
        if (auth.statusCode !== 200) {
            res.status(auth.statusCode).end();
            return;
        }
        save(auth.decoded.sub, req.body);
        res.end();
    } catch (err) {
        console.error(err);
        res.status(503).end();
    }
});


app.get('/report', async function (req, res) {
    try {
        res.set('Content-Type', 'text/plain');
        res.send(await csv());
        res.end();
    } catch (err) {
        console.error(err);
        res.status(503).end();
    }
});

app.listen(3000);    
