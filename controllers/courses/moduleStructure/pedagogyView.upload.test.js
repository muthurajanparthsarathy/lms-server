const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function upload({ failure = false, nested = false } = {}) {
  let saved = false;
  let uploadPath;
  const element = { files: [], folders: nested ? [{ name: 'Documents', files: [], subfolders: [] }] : [] };
  const entity = {
    pedagogy: { I_Do: new Map([['Resources', element]]) },
    markModified() {},
    async save() { saved = true; return this; },
  };
  const dependencies = {
    mongoose: { model: () => ({ findById: async () => entity }), Types: { ObjectId: class {} } },
    'fluent-ffmpeg': { setFfmpegPath() {}, setFfprobePath() {} },
    'ffprobe-static': { path: '' },
    '../../../utils/pedagogyScope': {
      resolvePedagogyScope: async () => ({ container: entity.pedagogy, basePath: 'pedagogy' }),
    },
    '../../../utils/storage': {
      storage: { from: () => ({ upload: async (filePath, bytes) => {
        uploadPath = filePath;
        assert.equal(bytes.toString(), 'Lesson content');
        return { error: failure ? new Error('Storage unavailable') : null };
      } }) },
      publicUrlFor: (filePath) => `https://res.cloudinary.com/test/raw/upload/${filePath}`,
    },
  };
  const controller = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'pedagogyView.js'), 'utf8'), {
    exports: controller,
    require: (name) => {
      assert.ok(!name.includes('supabase'), 'resource uploads must not use the retired Supabase client');
      return dependencies[name] || {};
    },
    Map, Buffer, console: { log() {}, warn() {}, error() {} },
  });
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await controller.updateEntity({
    params: { type: 'modules', id: 'test-module' },
    body: { tabType: 'I_Do', subcategory: 'Resources', folderPath: nested ? 'Documents' : '', isUpdate: 'false' },
    user: { email: 'test@example.test' },
    files: { files: { name: 'lesson.txt', mimetype: 'text/plain', size: 14, data: Buffer.from('Lesson content') } },
  }, res);
  return { res, saved, uploadPath, files: nested ? element.folders[0].files : element.files };
}

for (const nested of [false, true]) {
  test(`uploads a resource ${nested ? 'inside a folder' : 'at root'} and saves its Cloudinary URL`, async () => {
    const result = await upload({ nested });
    assert.equal(result.res.code, 200, JSON.stringify(result.res.body));
    assert.equal(result.saved, true);
    assert.equal(result.files.length, 1);
    assert.match(result.files[0].fileUrl.get('base'), /^https:\/\/res\.cloudinary\.com\//);
    assert.ok(result.uploadPath.includes(nested ? '/Documents/' : '/root/'));
  });
}

test('failed storage upload returns an error and never reports a successful save', async () => {
  const result = await upload({ failure: true });
  assert.equal(result.res.code, 500);
  assert.match(result.res.body.message[0].value, /Storage unavailable/);
  assert.equal(result.saved, false);
  assert.equal(result.files.length, 0);
});
