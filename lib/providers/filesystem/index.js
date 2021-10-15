// Copyright IBM Corp. 2013,2019. All Rights Reserved.
// Node module: loopback-component-storage
// This file is licensed under the Artistic License 2.0.
// License text available at https://opensource.org/licenses/Artistic-2.0

'use strict';

// Globalization
const g = require('strong-globalize')();

/**
 * File system based on storage provider
 */

const fs = require('fs'),
  path = require('path'),
  stream = require('stream'),
  async = require('async'),
  File = require('./file').File,
  Container = require('./container').Container;

const utils = require('./../../utils');

module.exports.storage = module.exports; // To make it consistent with pkgcloud

module.exports.File = File;
module.exports.Container = Container;
module.exports.Client = FileSystemProvider;
module.exports.createClient = function(options) {
  return new FileSystemProvider(options);
};

function FileSystemProvider(options) {
  options = options || {};

  if (!path.isAbsolute(options.root)) {
    const basePath = path.dirname(path.dirname(require.main.filename));
    options.root = path.join(basePath, options.root);
  }

  this.root = options.root;
  const exists = fs.existsSync(this.root);
  if (!exists) {
    throw new Error(g.f('{{FileSystemProvider}}: Path does not exist: %s', this.root));
  }
  const stat = fs.statSync(this.root);
  if (!stat.isDirectory()) {
    throw new Error(g.f('{{FileSystemProvider}}: Invalid directory: %s', this.root));
  }
}

const namePattern = new RegExp('[^' + path.sep + '/]+');
// To detect any file/directory containing dotdot paths
const containsDotDotPaths = /(^|[\\\/])\.\.([\\\/]|$)/;

function validateName(name, cb) {
  if (!name || containsDotDotPaths.test(name)) {
    cb && process.nextTick(cb.bind(null, new Error(g.f('Invalid name: %s', name))));
    if (!cb) {
      console.error(g.f('{{FileSystemProvider}}: Invalid name: %s', name));
    }
    return false;
  }
  const match = namePattern.exec(name);
  if (match && match.index === 0 && match[0].length === name.length) {
    return true;
  } else {
    cb && process.nextTick(cb.bind(null,
      new Error(g.f('{{FileSystemProvider}}: Invalid name: %s', name))));
    if (!cb) {
      console.error(g.f('{{FileSystemProvider}}: Invalid name: %s', name));
    }
    return false;
  }
}

function streamError(errStream, err, cb) {
  process.nextTick(function() {
    errStream.emit('error', err);
    cb && cb(null, err);
  });
  return errStream;
}

const writeStreamError = streamError.bind(null, new stream.Writable());
const readStreamError = streamError.bind(null, new stream.PassThrough());

/*!
 * Populate the metadata from file stat into props
 * @param {fs.Stats} stat The file stat instance
 * @param {Object} props The metadata object
 */
function populateMetadata(stat, props) {
  for (const p in stat) {
    switch (p) {
      case 'size':
      case 'atime':
      case 'mtime':
      case 'ctime':
        props[p] = stat[p];
        break;
    }
  }
}

FileSystemProvider.prototype.getContainers = function(cb) {
  cb = cb || utils.createPromiseCallback();

  const self = this;
  fs.readdir(self.root, function(err, files) {
    const containers = [];
    const tasks = [];

    if (!files) {
      files = [];
    }

    files.forEach(function(f) {
      tasks.push(fs.stat.bind(fs, path.join(self.root, f)));
    });
    async.parallel(tasks, function(err, stats) {
      if (err) {
        cb && cb(err);
      } else {
        stats.forEach(function(stat, index) {
          if (stat.isDirectory()) {
            const name = files[index];
            const props = {name: name};
            populateMetadata(stat, props);
            const container = new Container(self, props);
            containers.push(container);
          }
        });
        cb && cb(err, containers);
      }
    });
  });

  return cb.promise;
};

FileSystemProvider.prototype.createContainer = function(options, cb) {
  cb = cb || utils.createPromiseCallback();

  const self = this;
  const name = options.name;
  const dir = path.join(this.root, name);
  validateName(name, cb) && fs.mkdir(dir, options, function(err) {
    if (err) {
      cb && cb(err);
      return;
    }
    fs.stat(dir, function(err, stat) {
      let container = null;
      if (!err) {
        const props = {name: name};
        populateMetadata(stat, props);
        container = new Container(self, props);
      }
      cb && cb(err, container);
    });
  });

  return cb.promise;
};

FileSystemProvider.prototype.destroyContainer = function(containerName, cb) {
  cb = cb || utils.createPromiseCallback();

  if (!validateName(containerName, cb)) return;

  const dir = path.join(this.root, containerName);
  fs.readdir(dir, function(err, files) {
    files = files || [];

    const tasks = [];
    files.forEach(function(f) {
      tasks.push(fs.unlink.bind(fs, path.join(dir, f)));
    });
    async.parallel(tasks, function(err) {
      if (err) {
        cb && cb(err);
      } else {
        fs.rmdir(dir, cb);
      }
    });
  });

  return cb.promise;
};

FileSystemProvider.prototype.getContainer = function(containerName, cb) {
  cb = cb || utils.createPromiseCallback();

  const self = this;
  if (!validateName(containerName, cb)) return;
  const dir = path.join(this.root, containerName);
  fs.stat(dir, function(err, stat) {
    let container = null;
    if (!err) {
      const props = {name: containerName};
      populateMetadata(stat, props);
      container = new Container(self, props);
    }
    cb && cb(err, container);
  });

  return cb.promise;
};

// File related functions
FileSystemProvider.prototype.upload = function(options, cb) {
  const container = options.container;
  if (!validateName(container)) {
    return writeStreamError(
      new Error(g.f('{{FileSystemProvider}}: Invalid name: %s', container)),
      cb,
    );
  }
  const file = options.remote;
  if (!validateName(file)) {
    return writeStreamError(
      new Error(g.f('{{FileSystemProvider}}: Invalid name: %s', file)),
      cb,
    );
  }
  const filePath = path.join(this.root, container, file);

  const fileOpts = {flags: options.flags || 'w+',
    encoding: options.encoding || null,
    mode: options.mode || parseInt('0666', 8),
  };

  try {
    // simulate the success event in filesystem provider
    // fixes: https://github.com/strongloop/loopback-component-storage/issues/58
    // & #23 & #67
    const stream = fs.createWriteStream(filePath, fileOpts);
    stream.on('finish', function() {
      stream.emit('success');
    });
    return stream;
  } catch (e) {
    return writeStreamError(e, cb);
  }
};

FileSystemProvider.prototype.download = function(options, cb) {
  const container = options.container;
  if (!validateName(container, cb)) {
    return readStreamError(
      new Error(g.f('{{FileSystemProvider}}: Invalid name: %s', container)),
      cb,
    );
  }
  const file = options.remote;
  if (!validateName(file, cb)) {
    return readStreamError(
      new Error(g.f('{{FileSystemProvider}}: Invalid name: %s', file)),
      cb,
    );
  }

  const filePath = path.join(this.root, container, file);

  const fileOpts = {flags: 'r',
    autoClose: true};

  if (options.start) {
    fileOpts.start = options.start;
    fileOpts.end = options.end;
  }

  try {
    return fs.createReadStream(filePath, fileOpts);
  } catch (e) {
    return readStreamError(e, cb);
  }
};

FileSystemProvider.prototype.getFiles = function(container, options, cb) {
  if (typeof options === 'function' && !(options instanceof RegExp)) {
    cb = options;
    options = false;
  }

  cb = cb || utils.createPromiseCallback();

  const self = this;
  if (!validateName(container, cb)) return;
  const dir = path.join(this.root, container);
  fs.readdir(dir, function(err, entries) {
    entries = entries || [];
    const files = [];
    const tasks = [];
    entries.forEach(function(f) {
      tasks.push(fs.stat.bind(fs, path.join(dir, f)));
    });
    async.parallel(tasks, function(err, stats) {
      if (err) {
        cb && cb(err);
      } else {
        stats.forEach(function(stat, index) {
          if (stat.isFile()) {
            const props = {container: container, name: entries[index]};
            populateMetadata(stat, props);
            const file = new File(self, props);
            files.push(file);
          }
        });
        cb && cb(err, files);
      }
    });
  });

  return cb.promise;
};

FileSystemProvider.prototype.getFile = function(container, file, cb) {
  cb = cb || utils.createPromiseCallback();

  const self = this;
  if (!validateName(container, cb)) return;
  if (!validateName(file, cb)) return;
  const filePath = path.join(this.root, container, file);
  fs.stat(filePath, function(err, stat) {
    let f = null;
    if (!err) {
      const props = {container: container, name: file};
      populateMetadata(stat, props);
      f = new File(self, props);
    }
    cb && cb(err, f);
  });

  return cb.promise;
};

FileSystemProvider.prototype.getUrl = function(options) {
  options = options || {};
  const filePath = path.join(this.root, options.container, options.path);
  return filePath;
};

FileSystemProvider.prototype.removeFile = function(container, file, cb) {
  cb = cb || utils.createPromiseCallback();

  if (!validateName(container, cb)) return;
  if (!validateName(file, cb)) return;

  const filePath = path.join(this.root, container, file);
  fs.unlink(filePath, cb);

  return cb.promise;
};
