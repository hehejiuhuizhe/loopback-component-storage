// Copyright IBM Corp. 2013,2019. All Rights Reserved.
// Node module: loopback-component-storage
// This file is licensed under the Artistic License 2.0.
// License text available at https://opensource.org/licenses/Artistic-2.0

'use strict';

const base = require('pkgcloud').storage;
const util = require('util');

exports.File = File;

function File(client, details) {
  base.File.call(this, client, details);
}

util.inherits(File, base.File);

File.prototype._setProperties = function(details) {
  for (const k in details) {
    if (typeof details[k] !== 'function') {
      this[k] = details[k];
    }
  }
};
