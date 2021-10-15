// Copyright IBM Corp. 2013,2019. All Rights Reserved.
// Node module: loopback-component-storage
// This file is licensed under the Artistic License 2.0.
// License text available at https://opensource.org/licenses/Artistic-2.0

'use strict';

const StorageService = require('./storage-service');
/**
 * Initialize the storage service as a connector for LoopBack data sources
 * @param {DataSource} dataSource DataSource instance
 * @prop {Object} settings Connector settings
 * @callback {Function} callback Callback function
 * @param {String|Object} err Error string or object
 */
exports.initialize = function(dataSource, callback) {
  const settings = dataSource.settings || {};

  const connector = new StorageService(settings);
  dataSource.connector = connector;
  dataSource.connector.dataSource = dataSource;

  connector.DataAccessObject = function() {
  };
  for (const m in StorageService.prototype) {
    const method = StorageService.prototype[m];
    if ('function' === typeof method) {
      connector.DataAccessObject[m] = method.bind(connector);
      for (const k in method) {
        connector.DataAccessObject[m][k] = method[k];
      }
    }
  }

  connector.define = function(model, properties, settings) {
  };
};
