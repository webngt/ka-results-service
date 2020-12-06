const stringify = require('csv-stringify');
const express = require('express');
const app = express();
const { catchErrors, gracefulShutdown } = require("@banzaicloud/service-tools");

catchErrors();
gracefulShutdown();

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
    const table = [];
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

app.post('/save', function (req, res) {
    const user = 'test_user';
    save(user, req.body);
    res.end();
});

app.get('/report', async function (req, res) {
    res.set('Content-Type', 'text/plain');
    res.send(await csv());
});

app.listen(3000);    

//(async () => {
//
//})();