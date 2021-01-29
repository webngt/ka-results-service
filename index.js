const stringify = require('csv-stringify');
const fs = require('fs');
const { Sequelize, DataTypes } = require('sequelize');
const jose = require('node-jose');

const express = require('express');
const app = express();

process.on('unhandledRejection', error => {
    console.error('unhandledRejection', error);
    process.exit(1);
  });

const db_config = JSON.parse(fs.readFileSync('secrets/db.json'));
const ks_config = JSON.parse(fs.readFileSync('secrets/keys.json'));

const sequelize = new Sequelize(db_config.db_url);

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
    results.every(item => {
        if (item.createdAt === undefined ||
            item.user_id === undefined ||
            item.data === undefined ||  
            item.data.deny === undefined) {
            return;
        }
        table.push([
            item.createdAt, 
            item.user_id, 
            item.data.task_id, 
            item.data.deny.length == 0 ? 'OK' : 'FAIL']
        );
    });

    return await table_to_csv(table);
}

async function save(user_id, data) {
    console.log(data.task_id);
    await Result.sync();
    await Result.create({ user_id, data});

    //storage.push({user_id, timestamp, data});
}


async function authorize(req, keystore) {
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
        const decoded = JSON.parse((await jose.JWE.createDecrypt(keystore).decrypt(parts[1])).payload.toString());
        const now = Math.floor(Date.now() / 1000);

        if (decoded.exp === undefined) {
            console.log('decoded.exp is undefined');
            return {
                statusCode: 401
            };            
        }

        if (decoded.exp < now) {
            console.log(`token exppired for: ${decoded.sub}`);
            return {
                statusCode: 401
            };            
        }

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

(async () => {

    const keystore = await jose.JWK.asKeyStore(JSON.stringify(ks_config));

    app.post('/save', async function (req, res) {
        try {
            const auth = await authorize(req, keystore);
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

})();
