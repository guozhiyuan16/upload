interface OPTIONS {
    baseURL?: string,
    method?: string,
    url: string,
    headers? : any, // ?为可选参数
    data?: any
    setXHR?: any
    onProgress?: any
}

export function request(options: OPTIONS): Promise<any> {
    let defaultOptions = {
        method: 'GET',
        baseURL: 'http://localhost:8000',
        headers: {},
        data: {}
    }
    options = {...defaultOptions, ...options , headers:{ ...defaultOptions.headers, ...(options.headers || {}) }};
    return new Promise(function(resolve:Function, reject:Function){
        let xhr = new XMLHttpRequest();
        xhr.open(options.method || "GET", options.baseURL + options.url);
        for(let key in options.headers){
            xhr.setRequestHeader(key, options.headers[key]);
        }
        xhr.responseType = "json";
        xhr.upload.onprogress = options.onProgress; // 监听函数
        xhr.onreadystatechange = function(){
            if(xhr.readyState == 4){
                if(xhr.status == 200){
                    resolve(xhr.response);
                }else{
                    reject(xhr.response)
                }
            }
        };
        // 暂停时终端请求使用的
        if(options.setXHR){
            options.setXHR(xhr);
        }
        xhr.send(options.data)

    })
}