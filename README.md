# 大文件上传功能

## `前端`

### 上传基本步骤

```js

async function handleUpload() {
        if (!currentFile) {
            return message.error('你尚未选择文件');
        }
        if (!allowUpload(currentFile)) {
            return message.error('上传成功');
        }
        setUploadStatus(UploadStatus.UPLOADING)

        // 切片
        let partList: Part[] = createChunks(currentFile);

        // 计算哈希值 秒传的功能 通过webworker子进程来计算hash
        let fileHash = await calculateHash(partList);

        // 根据计算后的hash值生成文件名
        let lastDotIndex = currentFile.name.lastIndexOf('.'); // dog.jpg
        let extName = currentFile.name.slice(lastDotIndex); // .jpg
        let filename = `${fileHash}${extName}`; // hash.jpg

        // 设置hash名 （hash为32为字符串）
        setFilename(filename); 

        // 每个切片增加一些属性 
        partList.forEach((item: Part, index) => {
            item.filename = filename;   // hash文件名
            item.chunk_name = `${filename}-${index}`;  //hash切片索引名
            item.loaded = 0;
            item.percent = 0;
        })

        // 设置partList
        setPartList(partList);

        // 开始上传 
        await uploadParts(partList, filename);
    }
```

#### 文件切片

- `文件切片并且返回切片列表，列表中每一项增加size属性`


```js

interface Part {
    chunk: Blob
    size: number
    filename?: string
    chunk_name?: string
    loaded?: number
    percent?: number
    xhr?: XMLHttpRequest
}
const DEFAULT_SIZE = 1024 * 1024 * 100; // 默认切片大小100M分段

// 文件切片
function createChunks(file:File): Part[] {
    const partList = Part[] = [];
    let current = 0;
    while(current >= file.size){
        let chunk = file.slice(current,current * DEFAULT_SIZE);
        partList.push({chunk, size:chunk.size})
        current += DEFAULT_SIZE
    }
    return partList;
}
```

#### 计算文件hash值

- `秒传的功能` （通过webworker子进程来计算哈希）

```js
function calculateHash(partList:Part[]){
    return new Promise(resolve => {
        let worker = new Worker('./hash'); // 创建webworker
        worker.postMessage({ partList })
        worker.onmessage = function (event) {
            let { percent, hash } = event.data;
            
            setHashPercent(percent); // 设置hash值

            // 最后一次有hash值了
            if (hash) {
                resolve(hash);
            }
        }
    })
}
    
```

```js
// public/hash.js

self.importScripts('https://cdn.bootcss.com/spark-md5/3.0.0/spark-md5.min.js'); // 加载远程脚本

// File => 多个 Blob => 读取Blob读取成ArrayBuffer => spark 计算哈希值
self.onmessage = async (event) => { 
    let partList = event.data; // event.data拿到值
    const spark = new self.SparkMD5.ArrayBuffer(); // 引入远程脚本会全局注入这个类
    let percent = 0 ; // 百分比
    let perSize = 100 / partList.length; // 每个切片所占百分比
    let buffers = await Promise.all(partList.map(({
        chunk,
        size
    }) => new Promise((resolve) => {
        const reader = new FileReader(); // h5读取文件api
        reader.readAsArrayBuffer(chunk);
        reader.onload = function (event) {
            percent += perSize;
            self.postMessage({
                percent: Number(percent.toFixed(2))
            });
            resolve(event.target.result);
        }
    })));
    buffers.forEach(buffer => spark.append(buffer));
    // 通知主进程，当前的哈希计算已经全部完成,并且把最终的hash值给主进程发过去
    self.postMessage({
        percent: 100,
        hash: spark.end()
    });
    self.close();
}

```

#### 上传切片

```js
// 上传切片
async function uploadParts(partList: Part[], filename: string) {
    // 验证后台是否已经上传过
    let { needUpload, uploadList } = await verify(filename);
    if (!needUpload) {
        return message.success('秒传成功')
    }
    try {
        // 通过切片列表生成上传的请求数组
        let requests = createRequests(partList, uploadList, filename);

        // 上传切片
        await Promise.all(requests);

        // 告诉后台合并切片
        await request({ url: `/merge/${filename}`});
        message.success('上传成功')
        reset();
    } catch (e) {
        message.error('上传失败或暂停')
    }
}



```

##### 验证是否上传过（可实现秒传）

- 参数说明
  - `needUpload` 判断是否上传过，可以实现秒传（其实是后台有文件，根本没传）
  - `uploadList` 后端对应filename的所有切片列表(有可能有些切片不完整或者没有,用于断点续传)

```js
async function verify(filename: string) {
    return await request({ url: `/verify/${filename}` });
}
```

##### 通过切片列表生成上传的请求数组

```js
function createRequests(partList: Part[], uploadList: Uploaded[], filename: string) {
        return partList
            .filter((part: Part) => {
                // 找到了说明上传过
                let uploadFile = uploadList.find(item => item.filename === part.chunk_name)
                // 没有上传过
                if (!uploadFile) {
                    part.loaded = 0; // 已经上传的字节数0
                    part.percent = 0; // 已经上传的百分比就是0 分片上传过的百分比
                    return true;
                }
                // 上传过但不完整需要重新传
                if (uploadFile.size < part.chunk.size) {
                    part.loaded = uploadFile.size; // 已经上传的字节数
                    part.percent = Number((uploadFile.size / part.size * 100).toFixed(2)); // 已经上传的百分比
                    return true;
                }
                return false;
            })
            .map((part: Part) => request({
                url: `/upload/${filename}/${part.chunk_name}/${part.loaded}`,
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream' }, // 指定请求体的格式
                setXHR: (xhr: XMLHttpRequest) => part.xhr = xhr,
                onProgress: (event: ProgressEvent) => {
                    part.percent = Number(((part.loaded! + event.loaded) / part.chunk.size * 100).toFixed(2))
                    setPartList([...partList]);
                },
                data: part.chunk.slice(part.loaded) // 请求体
            }))

        // return partList.map((part: Part) => request({
        //     url: `/upload/${filename}/${part.chunk_name}`,
        //     method: 'POST',
        //     headers: { 'Content-Type': 'application/octet-stream' }, // 指定请求体的格式
        //     data: part.chunk // 请求体
        // }))
    }
```


## `后端`

### 后端`接收切片`

```js

import { TEMP_DIR, mergeChunks, PUBLIC_DIR } from './utils';

app.post('/upload/:filename/:chunk_name/:start', async function (req: Request, res: Response, _next: NextFunction) {
    let { filename, chunk_name } = req.params; // 获取文件名和切片名
    let start :number = Number(req.params.start); // 上传加参数实现断点续传
    let chunk_dir = path.resolve(TEMP_DIR, filename);
    let exist = await fs.pathExists(chunk_dir); // 判断文件夹在不在
    if (!exist) {
        await fs.mkdirs(chunk_dir);
    }
    let chunkFilePath = path.resolve(chunk_dir, chunk_name); // 创建分片路径
    // flags a:append
    let ws = fs.createWriteStream(chunkFilePath, { start, flags: 'a' });
    // 可读流读完了
    req.on('end', () => {
        ws.close();
        res.json({ success: true })
    })
    req.on('error', ()=>{
        ws.close();
    })
    req.on('close', ()=>{
        ws.close();
    })
    req.pipe(ws);

})
```

### `合并切片`

```js

import { TEMP_DIR, mergeChunks, PUBLIC_DIR } from './utils';

app.get('/merge/:filename', async function (req: Request, res: Response, _next: NextFunction) {
    let { filename } = req.params;
    await mergeChunks(filename);
    res.json({ success: true })
})
```

```js
// utils.js
const pipeStream = (filePath: string, ws: WriteStream) => {
    return new Promise((resolve: Function) => {
        let rs = fs.createReadStream(filePath);
        rs.on('end',async () => {
            await fs.unlink(filePath);
            resolve()
        })
        rs.pipe(ws);
    })
}
// 合并切片
export const mergeChunks = async (filename: string, size: number = DEFAULT_SIZE) => {
    const filePath = path.resolve(PUBLIC_DIR, filename); // 合并切片后文件存放路径
    let chunkDir = path.resolve(TEMP_DIR, filename); // 读取切片文件路径
    let chunks = await fs.readdir(chunkDir); // 读取切片文件路径下所有切片
    chunks.sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1])); // 按文件名后索引升序排列
    // 切片都封装成promise,并且并发读取
    await Promise.all(
        chunks.map((chunkFile, index) => pipeStream(
            path.resolve(chunkDir, chunkFile),
            fs.createWriteStream(
                filePath,
                {
                    start: index * size // 从那个位置开始写
                }
            )
        ))
    )
    await fs.rmdir(chunkDir);
}
```

### `验证接口`

```js
// // 每次先计算hash值
app.get('/verify/:filename', async (req: Request, res: Response, _next: NextFunction) => {
    let { filename } = req.params;

    // public下有完整文件，不需要上传了
    let filePath = path.resolve(PUBLIC_DIR, filename);
    let existFile = await fs.pathExists(filePath); // 判断目录是否存在
    if(existFile){
        res.json({
            success: true,
            needUpload: false //因为已经上传过了，所以不需要上传了，可以实现秒传
        })
    }

    const tempDir = path.resolve(TEMP_DIR, filename); // 读取temp下对应文件夹里所有的文件
    let exist = await fs.pathExists(tempDir);
    let uploadList: any[] = [];
    if (exist) {
        uploadList = await fs.readdir(tempDir);
        uploadList = await Promise.all(uploadList.map(async (filename: string) => {
            let stat = await fs.stat(path.resolve(tempDir, filename)); // 拿到文件详情
            return {
                filename, // 文件名
                size: stat.size // 现在的文件大小（有可能没传完）
            }
        }));
    } 
    res.json({
        success:true,
        needUpload: true, // 需要上传
        uploadList // 已经上传的文件列表，方便前端过滤
    })
})
```


# buffer blob 流 二进制 的区别 ？

- File接口基于Blob,继承了blob的功能并将其扩展使其支持用户系统上的文件