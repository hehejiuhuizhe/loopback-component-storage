// Copyright IBM Corp. 2014,2019. All Rights Reserved.
// Node module: loopback-component-storage
// This file is licensed under the Artistic License 2.0.
// License text available at https://opensource.org/licenses/Artistic-2.0

'use strict';

const request = require('supertest');
const loopback = require('@sansitech/loopback');
const assert = require('assert');
const semver = require('semver');

const app = loopback();
const path = require('path');

// configure errorHandler to show full error message
app.set('remoting', {errorHandler: {debug: true, log: false}});
// custom route with renamer
app.post('/custom/upload', function(req, res, next) {
  const options = {
    container: 'album1',
    getFilename: function(file, req, res) {
      return file.field + '_' + file.name;
    },
  };
  ds.connector.upload(req, res, options, function(err, result) {
    if (!err) {
      res.setHeader('Content-Type', 'application/json');
      res.status(200).send({result: result});
    } else {
      res.status(500).send(err);
    }
  });
});

// custom route with renamer
app.post('/custom/uploadWithContainer', function(req, res, next) {
  const options = {
    getFilename: function(file, req, res) {
      return file.field + '_' + file.name;
    },
  };
  ds.connector.upload('album1', req, res, options, function(err, result) {
    if (!err) {
      res.setHeader('Content-Type', 'application/json');
      res.status(200).send({result: result});
    } else {
      res.status(500).send(err);
    }
  });
});

// expose a rest api
app.use(loopback.rest());

const dsImage = loopback.createDataSource({
  connector: require('../lib/storage-connector'),
  provider: 'filesystem',
  root: path.join(__dirname, 'images'),

  getFilename: function(fileInfo) {
    return 'image-' + fileInfo.name;
  },
  acl: 'public-read',
  allowedContentTypes: ['image/png', 'image/jpeg'],
  maxFileSize: 5 * 1024 * 1024,
});

const ImageContainer = dsImage.createModel('imageContainer');
app.model(ImageContainer);

const ds = loopback.createDataSource({
  connector: require('../lib/storage-connector'),
  provider: 'filesystem',
  forbidExtnames: ['.hehe'],
  root: path.join(__dirname, 'images'),
});

const Container = ds.createModel('container', {}, {base: 'Model'});
app.model(Container);

/*!
 * Verify that the JSON response has the correct metadata properties.
 * Please note the metadata vary by storage providers. This test assumes
 * the 'filesystem' provider.
 *
 * @param {String} containerOrFile The container/file object
 * @param {String} [name] The name to be checked if not undefined
 */
function verifyMetadata(containerOrFile, name) {
  assert(containerOrFile);

  // Name
  if (name) {
    assert.equal(containerOrFile.name, name);
  }
  // No sensitive information
  assert(containerOrFile.uid === undefined);
  assert(containerOrFile.gid === undefined);

  // Timestamps
  assert(containerOrFile.atime);
  assert(containerOrFile.ctime);
  assert(containerOrFile.mtime);

  // Size
  assert.equal(typeof containerOrFile.size, 'number');
}

describe('storage service', function() {
  let server = null;
  before(function(done) {
    server = app.listen(0, function() {
      done();
    });
  });

  after(function() {
    server.close();
  });

  it('should create a container', function(done) {
    request('http://localhost:' + app.get('port'))
      .post('/containers')
      .send({name: 'test-container'})
      .set('Accept', 'application/json')
      .set('Content-Type', 'application/json')
      .expect('Content-Type', /json/)
      .expect(200, function(err, res) {
        verifyMetadata(res.body, 'test-container');
        done();
      });
  });

  it('should get a container', function(done) {
    request('http://localhost:' + app.get('port'))
      .get('/containers/test-container')
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(200, function(err, res) {
        verifyMetadata(res.body, 'test-container');
        done();
      });
  });

  it('should list containers', function(done) {
    request('http://localhost:' + app.get('port'))
      .get('/containers')
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(200, function(err, res) {
        assert(Array.isArray(res.body));
        assert.equal(res.body.length, 2);
        res.body.forEach(function(c) {
          verifyMetadata(c);
        });
        done();
      });
  });

  it('should delete a container', function(done) {
    request('http://localhost:' + app.get('port'))
      .del('/containers/test-container')
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(200, function(err, res) {
        done();
      });
  });

  it('should list containers after delete', function(done) {
    request('http://localhost:' + app.get('port'))
      .get('/containers')
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(200, function(err, res) {
        assert(Array.isArray(res.body));
        assert.equal(res.body.length, 1);
        done();
      });
  });

  it('should list files', function(done) {
    request('http://localhost:' + app.get('port'))
      .get('/containers/album1/files')
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(200, function(err, res) {
        assert(Array.isArray(res.body));
        res.body.forEach(function(f) {
          verifyMetadata(f);
        });
        done();
      });
  });

  it('uploads files', function(done) {
    request('http://localhost:' + app.get('port'))
      .post('/containers/album1/upload')
      .attach('image', path.join(__dirname, './fixtures/test.jpg'))
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(200, function(err, res) {
        assert.deepStrictEqual(res.body, {
          result: {
            files: {
              image: [
                {
                  container: 'album1',
                  name: 'test.jpg',
                  type: 'image/jpeg',
                  field: 'image',
                  size: 60475,
                  md5: '36b80ac135d185a4d729248fe8def2f5',
                  sha256: '8a6eb267bf156632bb32e978dbf22aec1cd217ad66635aa23812110c858f42ab',
                },
              ],
            },
            fields: {},
          },
        });
        done();
      });
  });

  it('fails to upload using dotdot file path (1)', function(done) {
    request('http://localhost:' + app.get('port'))
      .post('/containers/%2e%2e/upload')
      .expect(200, function(err, res) {
        assert(err);
        done();
      });
  });

  it('fails to upload using dotdot file path (2)', function(done) {
    request('http://localhost:' + app.get('port'))
      .post('%2e%2e/containers/upload')
      .expect(200, function(err, res) {
        assert(err);
        done();
      });
  });

  it('fails to upload using dotdot file path (3)', function(done) {
    request('http://localhost:' + app.get('port'))
      .post('%2e%2e')
      .expect(200, function(err, res) {
        assert(err);
        done();
      });
  });

  it('fails to upload using dotdot file path (4)', function(done) {
    request('http://localhost:' + app.get('port'))
      .post('/containers/upload/%2e%2e')
      .expect(200, function(err, res) {
        assert(err);
        done();
      });
  });

  it('uploads files with renamer', function(done) {
    request('http://localhost:' + app.get('port'))
      .post('/imageContainers/album1/upload')
      .attach('image', path.join(__dirname, './fixtures/test.jpg'))
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(200, function(err, res) {
        assert.deepStrictEqual(res.body, {
          result: {
            files: {
              image: [
                {
                  container: 'album1',
                  name: 'image-test.jpg',
                  originalFilename: 'test.jpg',
                  md5: '36b80ac135d185a4d729248fe8def2f5',
                  sha256: '8a6eb267bf156632bb32e978dbf22aec1cd217ad66635aa23812110c858f42ab',
                  type: 'image/jpeg',
                  field: 'image',
                  acl: 'public-read',
                  size: 60475,
                },
              ],
            },
            fields: {},
          },
        });
        done();
      });
  });

  it('uploads file wrong content type', function(done) {
    request('http://localhost:' + app.get('port'))
      .post('/imageContainers/album1/upload')
      .attach('image', path.join(__dirname, './fixtures/app.js'))
      .set('Accept', 'application/json')
      .set('Connection', 'keep-alive')
      .expect('Content-Type', /json/)
      .expect(500, function(err, res) {
        assert(res.body.error.message.indexOf('is not allowed') !== -1);
        done(err);
      });
  });

  it('uploads file forbid extname', function(done) {
    request('http://localhost:' + app.get('port'))
      .post('/containers/album1/upload')
      .attach('image', path.join(__dirname, './fixtures/test.hehe'))
      .set('Accept', 'application/json')
      .set('Connection', 'keep-alive')
      .expect('Content-Type', /json/)
      .expect(500, function(err, res) {
        assert(res.body.error.message.indexOf('is not allowed') !== -1);
        done(err);
      });
  });

  it('uploads file forbid extname upperCase', function(done) {
    request('http://localhost:' + app.get('port'))
      .post('/containers/album1/upload')
      .attach('image', path.join(__dirname, './fixtures/testUpper.HEHE'))
      .set('Accept', 'application/json')
      .set('Connection', 'keep-alive')
      .expect('Content-Type', /json/)
      .expect(500, function(err, res) {
        assert(res.body.error.message.indexOf('is not allowed') !== -1);
        done(err);
      });
  });

  it('uploads file too large', function(done) {
    request('http://localhost:' + app.get('port'))
      .post('/imageContainers/album1/upload')
      .attach('image', path.join(__dirname, './fixtures/largeImage.jpg'))
      .set('Accept', 'application/json')
      .set('Connection', 'keep-alive')
      .expect('Content-Type', /json/)
      .expect(200, function(err, res) {
        assert(err);
        assert(res.body.error.message.indexOf('maxFileSize exceeded') !== -1);
        done();
      });
  });

  it('returns error when no file is provided to upload', function(done) {
    if (semver.gt(process.versions.node, '4.0.0')) {
      request('http://localhost:' + app.get('port'))
        .post('/imageContainers/album1/upload')
        .set('Accept', 'application/json')
        .set('Connection', 'keep-alive')
        .expect('Content-Type', /json/)
        .expect(400, function(err, res) {
          const indexOfMsg = res.body.error.message
            .toLowerCase()
            .indexOf('no file');
          assert.notEqual(
            indexOfMsg,
            -1,
            'Error message does not contain "no file"',
          );
          done(err);
        });
    } else {
      request('http://localhost:' + app.get('port'))
        .post('/imageContainers/album1/upload')
        .set('Accept', 'application/json')
        .set('Connection', 'keep-alive')
        .expect('Content-Type', /json/)
        .expect(500, function(err, res) {
          assert.equal(
            res.body.error.message,
            'bad content-type header, no content-type',
          );
          done(err);
        });
    }
  });

  it('should get file by name', function(done) {
    request('http://localhost:' + app.get('port'))
      .get('/containers/album1/files/test.jpg')
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(200, function(err, res) {
        verifyMetadata(res.body, 'test.jpg');
        done();
      });
  });

  it('should get file by renamed file name', function(done) {
    request('http://localhost:' + app.get('port'))
      .get('/imageContainers/album1/files/image-test.jpg')
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(200, function(err, res) {
        verifyMetadata(res.body, 'image-test.jpg');
        done();
      });
  });

  it('downloads files', function(done) {
    request('http://localhost:' + app.get('port'))
      .get('/containers/album1/download/test.jpg')
      .expect('Content-Type', 'image/jpeg')
      .expect(200, function(err, res) {
        if (err) done(err);
        done();
      });
  });

  it('should run a function before a download is started by a client', function(done) {
    let hookCalled = false;

    const Container = app.models.Container;

    Container.beforeRemote('download', function(ctx, unused, cb) {
      hookCalled = true;
      cb();
    });

    request('http://localhost:' + app.get('port'))
      .get('/containers/album1/download/test.jpg')
      .expect('Content-Type', 'image/jpeg')
      .expect(200, function(err, res) {
        if (err) done(err);
        assert(hookCalled, 'beforeRemote hook was not called');
        done();
      });
  });

  it('should run a function after a download is started by a client', function(done) {
    let hookCalled = false;

    const Container = app.models.Container;

    Container.afterRemote('download', function(ctx, unused, cb) {
      hookCalled = true;
      cb();
    });

    request('http://localhost:' + app.get('port'))
      .get('/containers/album1/download/test.jpg')
      .expect('Content-Type', 'image/jpeg')
      .expect(200, function(err, res) {
        if (err) done(err);
        assert(hookCalled, 'afterRemote hook was not called');
        done();
      });
  });

  it('should run a function after a download failed', function(done) {
    let hookCalled = false;
    const Container = app.models.Container;

    Container.afterRemoteError('download', function(ctx, cb) {
      hookCalled = true;
      cb();
    });

    request('http://localhost:' + app.get('port'))
      .get('/containers/album1/download/does-not-exist')
      .expect(404, function(err, res) {
        if (err) return done(err);
        assert(hookCalled, 'afterRemoteEror hook was not called');
        done();
      });
  });

  it('should delete a file', function(done) {
    request('http://localhost:' + app.get('port'))
      .del('/containers/album1/files/test.jpg')
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(200, function(err, res) {
        done();
      });
  });

  it('reports errors if it fails to find the file to download', function(done) {
    request('http://localhost:' + app.get('port'))
      .get('/containers/album1/download/test_not_exist.jpg')
      .expect('Content-Type', /json/)
      .expect(500, function(err, res) {
        assert(res.body.error);
        done();
      });
  });

  it(
    'should upload a file with custom route accessing directly to the ' +
    'storage connector with renamer',
    function(done) {
      request('http://localhost:' + app.get('port'))
        .post('/custom/upload')
        .attach('customimagefield', path.join(__dirname, './fixtures/test.jpg'))
        .set('Accept', 'application/json')
        .expect('Content-Type', /json/)
        .expect(200, function(err, res) {
          assert.deepStrictEqual(res.body, {
            result: {
              files: {
                customimagefield: [
                  {
                    container: 'album1',
                    name: 'customimagefield_test.jpg',
                    originalFilename: 'test.jpg',
                    type: 'image/jpeg',
                    field: 'customimagefield',
                    size: 60475,
                    md5: '36b80ac135d185a4d729248fe8def2f5',
                    sha256: '8a6eb267bf156632bb32e978dbf22aec1cd217ad66635aa23812110c858f42ab',
                  },
                ],
              },
              fields: {},
            },
          });
          done();
        });
    },
  );

  it('should upload a file with container param', function(done) {
    request('http://localhost:' + app.get('port'))
      .post('/custom/uploadWithContainer')
      .attach('customimagefield1', path.join(__dirname, './fixtures/test.jpg'))
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(200, function(err, res) {
        assert.deepEqual(res.body, {
          result: {
            files: {
              customimagefield1: [
                {
                  container: 'album1',
                  name: 'customimagefield1_test.jpg',
                  originalFilename: 'test.jpg',
                  type: 'image/jpeg',
                  field: 'customimagefield1',
                  size: 60475,
                  md5: '36b80ac135d185a4d729248fe8def2f5',
                  sha256: '8a6eb267bf156632bb32e978dbf22aec1cd217ad66635aa23812110c858f42ab',
                },
              ],
            },
            fields: {},
          },
        });
        done();
      });
  });
});
