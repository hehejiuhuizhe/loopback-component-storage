// Copyright IBM Corp. 2013,2019. All Rights Reserved.
// Node module: loopback-component-storage
// This file is licensed under the Artistic License 2.0.
// License text available at https://opensource.org/licenses/Artistic-2.0

'use strict';

// Globalization
const g = require('strong-globalize')();

const IncomingForm = require('formidable');
const StringDecoder = require('string_decoder').StringDecoder;
const path = require('path');
const uuid = require('uuid');
const debug = require('debug')('loopback:storage:handler');
const crypto = require('crypto');

const defaultOptions = {
  maxFileSize: 10 * 1024 * 1024, // 10 MB
};

/**
 * Handle multipart/form-data upload to the storage service
 * @param {Object} provider The storage service provider
 * @param {Request} req The HTTP request
 * @param {Response} res The HTTP response
 * @param {Object} [options] The container name
 * @callback {Function} cb Callback function
 * @header storageService.upload(provider, req, res, options, cb)
 */
exports.upload = function(provider, req, res, options, cb) {
  if (!cb && 'function' === typeof options) {
    cb = options;
    options = {};
  }

  if (!options.maxFileSize) {
    options.maxFileSize = defaultOptions.maxFileSize;
  }

  const form = new IncomingForm(options);
  const container = options.container || req.params.container;
  debug('Uploading to container with options %o', options);
  const fields = {};
  const files = {};
  form.on('error', (err)=>{
    if (form.writer && !form.writer.destroyed) {
      form.writer.destroy();
    }
    if (form.filename) {
      provider.removeFile(container, form.filename, (removeErr)=>{
        if (removeErr) {
          console.error(removeErr);
        }
      });
    }
  });
  form.handlePart = function(part) {
    const self = this;

    if (part.filename === undefined || part.filename === '') {
      let value = '';
      const decoder = new StringDecoder(this.encoding);

      part.on('data', function(buffer) {
        self._fieldsSize += buffer.length;
        if (self._fieldsSize > self.maxFieldsSize) {
          self._error(new Error(
            g.f(
              '{{maxFieldsSize}} exceeded, received %s bytes of field data',
              self._fieldsSize,
            ),
          ));
          return;
        }
        value += decoder.write(buffer);
      });

      part.on('end', function() {
        let values = fields[part.name];
        if (values === undefined) {
          values = [value];
          fields[part.name] = values;
        } else {
          values.push(value);
        }
        self.emit('field', part.name, value);
      });
      return;
    }

    this._flushing++;

    const file = {
      container: container,
      name: part.filename,
      type: part.mime,
      field: part.name,
    };

    const extname = path.extname(part.filename);

    // Options for this file

    // Build a filename
    if ('function' === typeof options.getFilename) {
      file.originalFilename = file.name;
      file.name = options.getFilename(file, req, res);
    } else if (options.nameConflict === 'makeUnique') {
      file.originalFilename = file.name;
      file.name = uuid.v4() + path.extname(file.name);
    }
    form.filename = file.name;

    if (options.forbidExtnames) {
      const forbidExtnames = options.forbidExtnames;
      if (Array.isArray(forbidExtnames) && forbidExtnames.length !== 0) {
        if (forbidExtnames.map(t=>t.toLowerCase()).includes(extname.toLowerCase())) {
          self._error(new Error(
            g.f(
              '{{extname}} "%s" is not allowed (Must not be in [%s])',
              extname,
              forbidExtnames.join(', '),
            ),
          ));
          return;
        }
      }
    }

    // Get allowed mime types
    if (options.allowedContentTypes) {
      let allowedContentTypes;
      if ('function' === typeof options.allowedContentTypes) {
        allowedContentTypes = options.allowedContentTypes(file, req, res);
      } else {
        allowedContentTypes = options.allowedContentTypes;
      }
      if (Array.isArray(allowedContentTypes) && allowedContentTypes.length !== 0) {
        if (allowedContentTypes.indexOf(file.type) === -1) {
          self._error(new Error(
            g.f(
              '{{contentType}} "%s" is not allowed (Must be in [%s])',
              file.type,
              allowedContentTypes.join(', '),
            ),
          ));
          return;
        }
      }
    }

    // Get max file size
    let maxFileSize;
    if (options.maxFileSize) {
      if ('function' === typeof options.maxFileSize) {
        maxFileSize = options.maxFileSize(file, req, res);
      } else {
        maxFileSize = options.maxFileSize;
      }
    }

    // Get access control list
    if (options.acl) {
      if ('function' === typeof options.acl) {
        file.acl = options.acl(file, req, res);
      } else {
        file.acl = options.acl;
      }
    }

    self.emit('fileBegin', part.name, file);

    const uploadParams = {
      container: container,
      remote: file.name,
      contentType: file.type,
    };
    if (file.acl) {
      uploadParams.acl = file.acl;
    }

    // AWS specific options
    // See http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#upload-property
    const awsOptionNames = [
      'StorageClass',
      'CacheControl',
      'ServerSideEncryption',
      'SSEKMSKeyId',
      'SSECustomerAlgorithm',
      'SSECustomerKey',
      'SSECustomerKeyMD5',
    ];
    for (const awsOption of awsOptionNames) {
      if (typeof options[awsOption] !== 'undefined') {
        uploadParams[awsOption] = options[awsOption];
      }
    }

    const writer = provider.upload(uploadParams);
    form.writer = writer;
    const hash = crypto.createHash('md5');
    const sha256 = crypto.createHash('sha256');
    writer.on('error', function(err) {
      self.emit('error', err);
    });

    const endFunc = function(providerFile) {
      self._flushing--;

      file.providerResponse = providerFile;

      let values = files[part.name];
      if (values === undefined) {
        values = [file];
        files[part.name] = values;
      } else {
        values.push(file);
      }
      self.emit('file', part.name, file);
      self._maybeEnd();
    };

    writer.on('success', function(file) {
      endFunc(file);
    });

    let fileSize = 0;
    if (maxFileSize) {
      part.on('data', function(buffer) {
        fileSize += buffer.length;
        file.size = fileSize;
        if (fileSize > maxFileSize) {
          // We are missing some way to tell the provider to cancel upload/multipart upload of the current file.
          // - s3-upload-stream doesn't provide a way to do this in it's public interface
          // - We could call provider.delete file but it would not delete multipart data
          self._error(new Error(
            g.f(
              '{{maxFileSize}} exceeded, received %s bytes of field data (max is %s)',
              fileSize,
              maxFileSize,
            ),
          ));
          return;
        }
      });
    }

    part.on('data', function(buffer) {
      hash.update(buffer);
      sha256.update(buffer);
    });
    part.on('end', function() {
      writer.end();
      file.md5 = hash.digest('hex');
      file.sha256 = sha256.digest('hex');
    });
    part.pipe(writer, {end: false});
  };

  form.parse(req, function(err, _fields, _files) {
    cb = cb || function() {};

    if (err) {
      console.error(err);
      return cb(err);
    }

    if (Object.keys(_files).length === 0) {
      err = new Error('No file content uploaded');
      err.statusCode = 400; // DO NOT MODIFY res.status directly!
      return cb(err);
    }

    cb(null, {files: files, fields: fields});
  });
};

/**
 * Handle download from a container/file.
 * @param {Object} provider The storage service provider
 * @param {Request} req The HTTP request
 * @param {Response} res The HTTP response
 * @param {String} container The container name
 * @param {String} file The file name
 * @callback {Function} cb Callback function.
 * @header storageService.download(provider, req, res, container, file, cb)
 */
exports.download = function(provider, req, res, container, file, cb) {
  const fileName = path.basename(file);
  const params = {
    container: container || req && req.params.container,
    remote: file || req && req.params.file,
  };

  let range = null;

  if (!req) {
    // TODO(rfeng/bajtos) We should let the caller now about the problem!
    return;
  }

  if (req.headers) {
    range = req.headers.range || '';
  }

  if (!range) {
    return download(params);
  }

  provider.getFile(params.container, params.remote, function(err, stats) {
    if (err) {
      return cb(processError(err, params.remote));
    }

    setupPartialDownload(params, stats, res);
    download(params);
  });

  function download(params) {
    const reader = provider.download(params);

    res.type(fileName);

    reader.pipe(res);

    reader.on('error', function onReaderError(err) {
      cb(processError(err, params.remote));
      cb = function() {}; // avoid double-callback
    });

    reader.on('end', function onReaderEnd() {
      cb();
      cb = function() {}; // avoid double-callback
    });
  }

  function setupPartialDownload(params, stats, res) {
    const total = stats.size;

    const parts = range.replace(/bytes=/, '').split('-');
    const partialstart = parts[0];
    const partialend = parts[1];

    params.start = parseInt(partialstart, 10);
    params.end = partialend ? parseInt(partialend, 10) : total - 1;

    const chunksize = (params.end - params.start) + 1;

    res.status(206);
    res.set('Content-Range', 'bytes ' + params.start + '-' + params.end + '/' + total);
    res.set('Accept-Ranges', 'bytes');
    res.set('Content-Length', chunksize);
  }
};

function processError(err, fileName) {
  if (err.code === 'ENOENT') {
    err.statusCode = err.status = 404;
    // Hide the original message reported e.g. by FS provider, as it may
    // contain sensitive information.
    err.message = 'File not found: ' + fileName;
  }
  return err;
}
