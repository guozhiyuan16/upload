self.importScripts('https://cdn.bootcss.com/spark-md5/3.0.0/spark-md5.min.js');

// File => 多个 Blob => 读取Blob读取成ArrayBuffer => spark 计算哈希值
self.onmessage = async (event) => {
    let {
        partList
    } = event.data; // partList 是 blob类型
    const spark = new self.SparkMD5.ArrayBuffer(); // 计算hash需要arraybuffer
    let percent = 0; // 总体计算hash的百分比
    let perSize = 100 / partList.length; // 每计算完成一个part,相当于完成了百分之几
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
    // let buffers = await Promise.all(partList.map(({chunk,size}) => chunk.ArrayBuffer())); // 这样不方便拿到进度条
    buffers.forEach(buffer => spark.append(buffer));
    // 通知主进程，当前的哈希计算已经全部完成,并且把最终的hash值给主进程发过去
    self.postMessage({
        percent: 100,
        hash: spark.end()
    });
    self.close();
}
