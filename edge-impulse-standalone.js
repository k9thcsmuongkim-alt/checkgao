<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Camera Auto-Scanner</title>
    <style>
        body { background: #000; color: #fff; font-family: monospace; display: flex; flex-direction: column; align-items: center; margin: 0; }
        #controls { padding: 20px; text-align: center; background: #222; width: 100%; border-bottom: 1px solid #444; }
        button { padding: 15px 40px; font-size: 18px; background: #2196F3; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; }
        #log-area { width: 95%; height: 200px; background: #111; border: 1px solid #555; overflow-y: scroll; margin-top: 10px; padding: 10px; text-align: left; color: #0f0; white-space: pre-wrap; font-size: 13px; }
        canvas { width: 100%; max-width: 640px; border: 2px solid #00ff00; margin-top: 10px; }
        video { display: none; }
    </style>
    
    <script>
        window.varsBefore = Object.keys(window);
        console.log("Đã chụp ảnh các biến gốc.");
    </script>
</head>
<body>

    <div id="controls">
        <button id="btn-start" onclick="startScanner()">BẮT ĐẦU QUÉT & CHẠY</button>
        <div id="log-area">Sẵn sàng quét tìm tên hàm...</div>
    </div>

    <canvas id="output"></canvas>
    <video id="webcam" playsinline autoplay muted></video>

    <script> var module = { exports: {} }; var exports = module.exports; </script>
    <script src="edge-impulse-standalone.js"></script>
    <script src="run-impulse.js"></script>

    <script>
        const logArea = document.getElementById('log-area');
        const btn = document.getElementById('btn-start');
        const video = document.getElementById('webcam');
        const canvas = document.getElementById('output');
        const ctx = canvas.getContext('2d');
        var classifier = null;

        function log(msg, error=false) {
            const color = error ? '#ff5555' : '#00ff00';
            logArea.innerHTML = `<div style="color:${color}">[${new Date().toLocaleTimeString()}] ${msg}</div>` + logArea.innerHTML;
        }

        async function startScanner() {
            btn.style.display = 'none';
            log("--- BẮT ĐẦU QUÉT ---");

            try {
                // BƯỚC 3: TÌM SỰ KHÁC BIỆT (HÀM MỚI XUẤT HIỆN)
                const varsAfter = Object.keys(window);
                // Lọc ra các biến mới
                const newVars = varsAfter.filter(x => !window.varsBefore.includes(x));
                
                log("Đã phát hiện các biến mới: " + newVars.join(", "));

                // Tìm ứng viên sáng giá nhất (Là function, không phải biến rác)
                let foundFunc = null;
                let foundName = "";

                // Ưu tiên 1: Tìm trong module.exports (Nếu là chuẩn Node)
                if (typeof module.exports === 'function') {
                    foundFunc = module.exports;
                    foundName = "module.exports";
                } else if (typeof module.exports.createModule === 'function') {
                    foundFunc = module.exports.createModule;
                    foundName = "module.exports.createModule";
                }
                // Ưu tiên 2: Tìm trong danh sách biến toàn cục mới
                else {
                    for (let name of newVars) {
                        // Bỏ qua các biến hệ thống hoặc biến của mình
                        if (name === 'varsBefore' || name === 'module' || name === 'exports') continue;
                        
                        // Nếu là Function -> Khả năng cao là nó!
                        if (typeof window[name] === 'function') {
                            // Lọc thêm: Tên thường chứa 'Module', 'Edge', 'Impulse', 'Wasm'
                            if (name.includes("Module") || name.includes("Edge") || name.includes("Impulse")) {
                                foundFunc = window[name];
                                foundName = name;
                                break;
                            }
                        }
                    }
                }

                if (!foundFunc) {
                    // Thử tìm thủ công lần cuối các tên phổ biến
                    if (typeof createModule === 'function') { foundFunc = createModule; foundName = "createModule"; }
                    else if (typeof EdgeImpulseMod === 'function') { foundFunc = EdgeImpulseMod; foundName = "EdgeImpulseMod"; }
                    else if (typeof Module === 'function') { foundFunc = Module; foundName = "Module"; }
                }

                if (!foundFunc) {
                    throw new Error("Không tìm thấy hàm khởi động nào! Có thể file JS chưa tải xong hoặc bị lỗi cú pháp.");
                }

                log(`✅ ĐÃ TÌM THẤY MỤC TIÊU: ${foundName}`);
                log(`🚀 Đang kích hoạt ${foundName}()...`);

                // --- BƯỚC 4: CHẠY THỬ HÀM TÌM ĐƯỢC ---
                
                // Cấu hình chỉ đường dẫn WASM (Sửa tên file wasm ở đây nếu cần)
                const wasmPath = "edge-impulse-standalone.wasm";
                const config = {
                    locateFile: (path) => {
                        log(`Hệ thống tìm: ${path} -> Ép dùng: ${wasmPath}`);
                        return wasmPath;
                    }
                };

                // Gọi hàm!
                await foundFunc(config);
                log("✅ Nạp WASM thành công!");

                // --- BƯỚC 5: KHỞI ĐỘNG CAMERA ---
                log("Đang khởi tạo Classifier...");
                classifier = new EdgeImpulseClassifier();
                await classifier.init();

                log("Đang mở Camera...");
                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: false,
                    video: { facingMode: "environment", width: 640, height: 480 }
                });
                video.srcObject = stream;
                
                video.onloadedmetadata = () => {
                    video.play();
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                    log("🎥 CAMERA ĐÃ LÊN HÌNH!");
                    requestAnimationFrame(loop);
                };

            } catch (err) {
                log("❌ LỖI: " + err.message, true);
                btn.style.display = 'block';
            }
        }

        async function loop() {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            if (classifier) {
                try {
                    let res = classifier.classifyElements(video);
                    if (res && res.results && res.results.length > 0) {
                        res.results.forEach(obj => {
                            if (obj.x !== undefined) {
                                ctx.strokeStyle = '#00FF00'; ctx.lineWidth = 4;
                                ctx.strokeRect(obj.x, obj.y, obj.width, obj.height);
                                ctx.fillStyle = '#00FF00'; ctx.font = '20px Arial';
                                ctx.fillText(obj.label, obj.x, obj.y - 5);
                            }
                        });
                    }
                } catch (e) {}
            }
            requestAnimationFrame(loop);
        }
    </script>
</body>
</html>
