// Copyright IBM Corp. 2014,2019. All Rights Reserved.
// Node module: loopback-component-storage
// This file is licensed under the Artistic License 2.0.
// License text available at https://opensource.org/licenses/Artistic-2.0

'use strict';

const SG = require('strong-globalize');
SG.SetRootDir(__dirname);

const StorageConnector = require('./lib/storage-connector');
StorageConnector.StorageService = require('./lib/storage-service');

module.exports = StorageConnector;
