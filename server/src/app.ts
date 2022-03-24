import express, { Request, Response, NextFunction } from 'express';
import logger from 'morgan';
import { INTERNAL_SERVER_ERROR } from 'http-status-codes'; // 500
import createError from 'http-errors';
import cors from 'cors';
import path from 'path';
import fs from 'fs-extra';
// import multiparty from 'multiparty'; // 处理文件上传的
// const PUBLIC_DIR = path.resolve(__dirname,'public')
import { TEMP_DIR, mergeChunks, PUBLIC_DIR } from './utils';

let app = express();
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(express.static(path.resolve(__dirname, 'public')));

app.post('/upload/:filename/:chunk_name/:start', async function (req: Request, res: Response, _next: NextFunction) {
    let { filename, chunk_name } = req.params; // 获取文件名和切片名
    let start :number = Number(req.params.start); // 上传加参数实现断点续传
    let chunk_dir = path.resolve(TEMP_DIR, filename);
    let exist = await fs.pathExists(chunk_dir); // 判断文件夹在不在
    if (!exist) {
        await fs.mkdirs(chunk_dir);
    }
    let chunkFilePath = path.resolve(chunk_dir, chunk_name); // 创建分片路径
    // flags a:append 后面断点续传 start
    let ws = fs.createWriteStream(chunkFilePath, { start, flags: 'a' });
    // 可读流读完了
    req.on('end', () => {
        ws.close();
        res.json({ success: true })
    })
    // 及时关闭流，防止删除temp下的文件无法删除导致报错
    req.on('error', ()=>{
        ws.close();
    })
    req.on('close', ()=>{
        ws.close();
    })
    req.pipe(ws);

})

app.get('/merge/:filename', async function (req: Request, res: Response, _next: NextFunction) {
    let { filename } = req.params;
    await mergeChunks(filename);
    res.json({ success: true })
})

// 每次先计算hash值
app.get('/verify/:filename', async (req: Request, res: Response, _next: NextFunction) => {
    let { filename } = req.params;

    // public下有完整文件，不需要上传了
    let filePath = path.resolve(PUBLIC_DIR, filename);
    let existFile = await fs.pathExists(filePath); // 判断目录是否存在
    console.log('existFile',existFile)
    if(existFile){
        return res.json({
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
    return res.json({
        success:true,
        needUpload: true, // 需要上传
        uploadList // 已经上传的文件列表，方便前端过滤
    })
})

// app.post('/upload', async function (req:Request, res: Response, next: NextFunction) {
//     let form = new multiparty.Form();
//     form.parse(req,async (err: any,fields,files)=>{
//         if(err){
//             return next(err)
//         }
//         console.log('fields',fields);
//         console.log('files',files);

//         // fields { filename: [ '截屏2022-03-07 上午9.22.28.png' ] }
//         // files {
//         // chunk: [
//         //     {
//         //     fieldName: 'chunk',
//         //     originalFilename: '截屏2022-03-07 上午9.22.28.png',
//         //     path: '/var/folders/0d/zxtrdqbx2hb5sb3rs53h74hm0000gn/T/jSLKnobnzvX0xjvlp7CC-Nil.png',
//         //     headers: [Object],
//         //     size: 41990
//         //     }
//         // ]
//         // }

//         let filename = fields.filename[0];
//         let chunk = files.chunk[0];
//         await fs.move(chunk.path,path.resolve(PUBLIC_DIR,filename) ,{overwrite: true})

//         res.json({success:true});
//     })
// })

app.use(function (_req: Request, _res: Response, next: NextFunction) {
    next(createError(404));
})

app.use(function (error: any, _req: Request, res: Response, _next: NextFunction) {
    res.status(error.status || INTERNAL_SERVER_ERROR);
    res.json({
        success: false,
        error
    })
})

export default app;