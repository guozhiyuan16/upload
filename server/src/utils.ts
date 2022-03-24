import path from 'path';
import fs,{WriteStream} from 'fs-extra';
const DEFAULT_SIZE = 1024 * 10;
export const PUBLIC_DIR = path.resolve(__dirname, 'public');
export const TEMP_DIR = path.resolve(__dirname, 'temp'); // 代码块临时目录

export const splitChunks = async (filename: string, size: number = DEFAULT_SIZE) => {
    let filePath = path.resolve(__dirname, filename); // 要分割的文件绝对路径
    const chunksDir = path.resolve(TEMP_DIR, filename); // 以文件名命名的临时目录，存放分割后的文件
    await fs.mkdirp(chunksDir); // 递归创建文件夹
    let content = await fs.readFile(filePath); // Buffer 其实是一个字节数组 1个字节是8bit位
    let i = 0, current = 0, length = content.length
    while (current < length) {
        await fs.writeFile(
            path.resolve(chunksDir, filename + '-' + i),
            content.slice(current, current + size)
        )
        i++;
        current += size;
    }
}

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

/**
 * 1. 读取temp目录下tom.jpeg目录里所有的文件,还要按尾部索引号排序
 * 2. 把他们累加在一起，另外一旦加过了要把temp目录里的文件删除
 * 3. 为了提高性能，尽量用流来实现， 不要readFile writeFile
 * @param filename 
 * @param size 
 */
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
                    start: index * size  // 从那个位置开始写
                }
            )
        ))
    )
    await fs.rmdir(chunkDir);
}

// splitChunks('basketball.jpeg');
// mergeChunks('basketball.jpeg');
