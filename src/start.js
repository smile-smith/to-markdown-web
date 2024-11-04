const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip-iconv');

const app = express();
const uploadsDir = path.join(__dirname, '../uploads');
const unzipDir = path.join(__dirname, '../unzip');
const downloadsDir = path.join(__dirname, '../downloads');

// 创建 uploads、unzip 和 downloads 目录（如果不存在）
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

if (!fs.existsSync(unzipDir)) {
  fs.mkdirSync(unzipDir, { recursive: true });
}

if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir, { recursive: true });
}

// 配置 multer，允许上传多个文件
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/x-xmind' || file.originalname.endsWith('.xmind')) {
      cb(null, true);
    } else {
      cb(new Error('仅支持 .xmind 文件'), false);
    }
  }
});

app.use(express.static('public'));
app.use(express.static(downloadsDir));

app.post('/upload', upload.array('files'), (req, res) => {
  const markdownLinks = [];

  const processFile = (file) => {
    const filePath = path.join(uploadsDir, file.originalname);
    const filename = file.originalname.replace('.xmind', '');
    const unzipPath = path.join(unzipDir, filename);
    const markdownFilePath = path.join(downloadsDir, `${filename}.md`);

    unzip(filePath, unzipPath);
    toMarkdown(filename, unzipPath, markdownFilePath);
    
    // 生成下载链接
    markdownLinks.push(`<a href="${filename}.md" download>${filename}.md</a><br>`);
  };

  req.files.forEach(processFile);

  // 返回所有下载链接
  if (markdownLinks.length > 0) {
    res.send(markdownLinks.join(''));
  } else {
    res.status(400).send('未上传有效的文件');
  }
});

app.get('/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(downloadsDir, filename);

  fs.stat(filePath, (err, stat) => {
    if (err) {
      return res.status(404).send('文件未找到');
    }

    const range = req.headers.range;
    if (!range) {
      return res.status(416).send('请求范围无效');
    }

    const positions = range.replace(/bytes=/, '').split('-');
    const start = parseInt(positions[0], 10);
    const end = positions[1] ? parseInt(positions[1], 10) : stat.size - 1;

    if (start >= stat.size || end >= stat.size || start > end) {
      return res.status(416).send('请求范围无效');
    }

    const chunksize = end - start + 1;
    const file = fs.createReadStream(filePath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'application/octet-stream',
    };

    res.writeHead(206, head);
    file.pipe(res);
  });
});

function unzip(filepath, target) {
  const zip = new AdmZip(filepath, 'gbk');
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }
  zip.extractAllTo(target, true);
}

function toMarkdown(filename, xmindDir, markdownFilePath) {
  let files = fs.readdirSync(xmindDir);
  const fd = fs.openSync(markdownFilePath, 'w+');
  
  for (let file of files) {
    let absfile = path.join(xmindDir, file);
    if (fs.statSync(absfile).isDirectory()) {
      continue;
    } else if (file === 'content.json') {
      let buffer = fs.readFileSync(absfile);
      let contentJsonArray = JSON.parse(buffer.toString('utf8'));
      let context = { name: filename, baseDir: xmindDir, fd: fd };
      for (let contentJson of contentJsonArray) {
        traverse(context, contentJson.rootTopic, 1);
      }
    }
  }
  fs.closeSync(fd);
}

function traverse(context, node, level) {
  if (!node) return;
  
  if (node.title) {
    const title = `${'#'.repeat(level)} ${node.title}\n\n`;
    fs.writeFileSync(context.fd, title);
  }
  
  if (node.notes?.plain?.content) {
    const content = `${node.notes.plain.content}\n\n`;
    fs.writeFileSync(context.fd, content);
  }

  if (node.children?.attached) {
    node.children.attached.forEach(child => traverse(context, child, level + 1));
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, (err) => {
  if (err) {
    console.error('启动服务器时出错:', err);
  } else {
    console.log(`Server is running on http://localhost:${PORT}`);
  }
});
