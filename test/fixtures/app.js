// Copyright IBM Corp. 2016,2019. All Rights Reserved.
// Node module: loopback-component-storage
// This file is licensed under the Artistic License 2.0.
// License text available at https://opensource.org/licenses/Artistic-2.0

'use strict';

const loopback = require('@sansitech/loopback');
const app = module.exports = loopback();

const path = require('path');

// expose a rest api
app.use('/api', loopback.rest());

app.use(loopback.static(path.join(__dirname, 'public')));

app.set('port', process.env.PORT || 3000);

const ds = loopback.createDataSource({
  connector: require('../index'),
  provider: 'filesystem',
  root: path.join(__dirname, 'storage'),
});

const container = ds.createModel('container');

app.model(container);

app.listen(app.get('port'));
console.log('http://127.0.0.1:' + app.get('port'));
