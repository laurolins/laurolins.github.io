
let doc;
let ctx;
let textures = [];
let wasm_update_frame = (ts) => {};
let wasm_malloc       = (size) => {};
let wasm_push_event   = (type, key, modifiers) => {};


let g_allocated; // A global reference of the WASM’s memory area so that we can look up pointers
let g_function_table;
let g_canvas;
let g_gpu_adapter;
let g_device;
let g_webgpu_context;
let g_format;

let g_uniform_batch_size_buffer = null;
let g_uniform_transform_buffer  = null;

// shaders
let g_shader_modules = [];
// gpu pipelines
let g_pipelines = [];
// gpu buffers
let g_buffers = [];

function clamp(low, high, value) {
        return Math.min(Math.max(low, value), high);
}

function parse_color(color) {
        color = Number(color);
        const r = ((color>>8*0)&0xFF).toString(16).padStart(2, 0);
        const g = ((color>>8*1)&0xFF).toString(16).padStart(2, 0);
        const b = ((color>>8*2)&0xFF).toString(16).padStart(2, 0);
        const a = ((color>>8*3)&0xFF).toString(16).padStart(2, 0);
        return '#'+r+g+b+a;
}

// pointer and length
function get_u8n(p, n) {
        return new Uint8Array(g_allocated.buffer, Number(p), n);
}

// pointer and length
function get_f32n(p, n) {
        return new Float32Array(g_allocated.buffer, Number(p), n/4);
}

const text_decoder = new TextDecoder();
function js_string_from_c_string(pointer, length) {
        // const u8 = new Uint8Array(allocated.buffer)
        const bytes = get_u8n(pointer, length);
        return text_decoder.decode(bytes);
}

async function fetch_blob_to_wasm(fetch_id, url, wasm_callback) {
        //{{{
        try {
                // Fetch the resource as a blob
                const response = await fetch(url);
                if (response.ok) {
                        const result_blob = await response.blob();
                        console.log(result_blob);

                        const result_buffer = await result_blob.arrayBuffer();
                        console.log(result_buffer);

                        const result_bytes = result_buffer.byteLength;

                        const wasm_pointer = wasm_malloc(result_bytes)
                        if (wasm_pointer) {
                                const wasm_buffer  = get_u8n(wasm_pointer, result_bytes);
                                console.log(wasm_pointer);
                                console.log(wasm_buffer);

                                const src = new Uint8Array(result_buffer);
                                wasm_buffer.set(src);

                                const success = 1;
                                wasm_callback(success, fetch_id, wasm_pointer, wasm_buffer.byteLength);
                        } else {
                                const failure = 0;
                                wasm_callback(failure, fetch_id, 0, 0);
                        }
                }
                else {
                        const failure = 0;
                        wasm_callback(failure, fetch_id, 0, 0);
                }

                /*
                // Convert blob to ArrayBuffer

                // Access WASM memory
                const memory = wasmInstance.exports.memory;
                const memoryBuffer = new Uint8Array(memory.buffer);

                // Allocate space in WASM memory
                const dataPointer = wasm_malloc(arrayBuffer.byteLength);
                if (!dataPointer) {
                        throw new Error("Failed to allocate memory in WASM");
                }

                get_u8n(dataPointer, blob.byteLength).set(new Uint8Array(arrayBuffer));

                // Copy the data into WASM memory
                memoryBuffer.set(new Uint8Array(arrayBuffer), dataPointer);

                // Call the C function, passing the pointer and size
                wasmInstance.exports.processBlob(dataPointer, arrayBuffer.byteLength);

                // Free the allocated memory
                // wasmInstance.exports.free(dataPointer);
                */
        } catch (error) {
                console.error("Error fetching or processing blob:", error);
        }
        //}}}
}

// These are all the functions that we declared as "#foreign" in our Jai code.
// They let you interact with the JS and DOM world from within Jai.
// If you forget to implement one, the Proxy below will log a nice error.
const exported_js_functions = {
        //{{{

        //{{{ WebGPU functions
        js_create_shader_module: (label_p, label_n, code_string_p, code_string_n) => {
                //{{{
                const label = js_string_from_c_string(label_p, label_n); 
                const code = js_string_from_c_string(code_string_p, code_string_n); 
                console.log(code);
                const shader_module = g_device.createShaderModule({code: code, label: label});
                const id = g_shader_modules.push(shader_module);
                return id;
                //}}}
        },
        js_create_compute_pipeline(compute_shader_module_id) {
                //{{{
                const compute_shader_module = g_shader_modules[compute_shader_module_id-1];
                const compute_pipeline_layout = g_device.createPipelineLayout({
                    bindGroupLayouts: [
                        g_device.createBindGroupLayout({
                          entries: [ 
                                  { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                                  { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                                  { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                                  { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                          ]
                        })
                    ],
                });
                const compute_pipeline = g_device.createComputePipeline({
                    layout: compute_pipeline_layout,
                    label: 'compute_pipeline',
                    compute: {
                        module: compute_shader_module,
                        entryPoint: 'main',
                    },
                });
                return g_pipelines.push(compute_pipeline);
                //}}}
        },
        js_create_render_pipeline(vertex_shader_module_id, fragment_shader_module_id) {
                //{{{
                const vertex_shader_module = g_shader_modules[vertex_shader_module_id-1];
                const fragment_shader_module = g_shader_modules[fragment_shader_module_id-1];
                        
                console.log("vertex", vertex_shader_module);
                console.log("fragment", fragment_shader_module);

                const render_pipeline_layout = g_device.createPipelineLayout({
                    bindGroupLayouts: [
                        g_device.createBindGroupLayout({
                          entries: [{
                            binding: 0,
                            visibility: GPUShaderStage.VERTEX,
                            buffer: { type: 'read-only-storage' }
                          }]
                        })
                    ],
                });

                const render_pipeline = g_device.createRenderPipeline({
                    layout: render_pipeline_layout,
                    label: 'render_pipeline',
                    vertex: {
                        module: vertex_shader_module,
                        entryPoint: 'main',
                    },
                    fragment: {
                        module: fragment_shader_module,
                        entryPoint: 'main',
                        targets: [{ format: g_format }],
                    },
                    primitive: {
                        topology: 'triangle-list',
                    },

                    depthStencil: undefined,
                });
                return g_pipelines.push(render_pipeline);
                //}}}
        },
        js_create_buffer_compute_input(size) {
                //{{{
                // const bufferSize = 3 * 2 * 4;  // 3 vertices, 2 components per vertex, 4 bytes per component (f32)
                const buffer = g_device.createBuffer({
                    size: size,
                    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
                });
                return g_buffers.push(buffer);
                //}}}
        },
        js_create_buffer_storage_vertex(size) {
                //{{{
                // const bufferSize = 3 * 2 * 4;  // 3 vertices, 2 components per vertex, 4 bytes per component (f32)
                const buffer = g_device.createBuffer({
                    size: size,
                    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_SRC,
                });
                return g_buffers.push(buffer);
                //}}}
        },
        js_create_buffer_uniform(size) {
                //{{{
                const buffer = g_device.createBuffer({
                    size: size,
                    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
                });
                return g_buffers.push(buffer);
                //}}}
        },
        //
        // turn on async if we need to debug the GPU buffer
        // by mapping it back to the CPU
        //
        /* async */ js_set_buffer_content(buffer_id, pointer, length) {
                //{{{
                const buffer = g_buffers[buffer_id-1];

                //
                // creating a copy from the view on the shared memory
                // webgpu memory, bc it is not working when transferring
                // it to the gpu buffer
                //
                const data = get_u8n(pointer, length).slice();
                // console.log(data);
                // const debug = get_f32n(pointer, length).slice();
                // console.log(debug);

                // g_device.queue.writeBuffer(buffer, 0, data);
                g_device.queue.writeBuffer(
                        buffer,             // The buffer to write to
                        0,                  // Offset in the buffer to start writing
                        data.buffer,       // The ArrayBuffer to copy data from
                        0,                  // Offset in the ArrayBuffer
                        data.byteLength    // Number of bytes to copy
                );

                //{{{
                // // To read it back:
                // const staging_buffer = g_device.createBuffer({
                //         size:  data.byteLength,
                //         usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
                // });

                // // Need a command encoder for the copy
                // const command_encoder = g_device.createCommandEncoder();
                // command_encoder.copyBufferToBuffer(
                //         buffer, 0,
                //         staging_buffer, 0,
                //         length
                // );
                // // Submit and wait
                // g_device.queue.submit([command_encoder.finish()]);

                // // Now we can read
                // await staging_buffer.mapAsync(GPUMapMode.READ);
                // const readback_data = new Float32Array(staging_buffer.getMappedRange());
                // console.log('Buffer contents:', readback_data);
                // staging_buffer.unmap();
                //}}}
                //}}}
        },
        /* async */ js_webgpu_render(
                n_input,             // number of input elements that the compute pass will process
                n_vertex,            // number of vertices that the render pass will process (output of the compute pass)
                batch_size_buffer_id,
                transform_buffer_id,
                input_buffer_id, 
                vertex_buffer_id, 
                compute_pipeline_id, 
                render_pipeline_id) {
                //{{{


                const batch_size_buffer = g_buffers[batch_size_buffer_id-1];
                const transform_buffer  = g_buffers[transform_buffer_id-1];

                const input_buffer  = g_buffers[input_buffer_id-1];
                const vertex_buffer = g_buffers[vertex_buffer_id-1];

                const compute_pipeline = g_pipelines[compute_pipeline_id-1];
                const render_pipeline  = g_pipelines[render_pipeline_id-1];

                const command_encoder  = g_device.createCommandEncoder();

                // console.log("vertex_buffer", vertex_buffer);
                // console.log("compute_pipeline", compute_pipeline);
                // console.log("render_pipeline", render_pipeline);

                // Dispatch Compute Shader
                const compute_pass = command_encoder.beginComputePass();
                compute_pass.setPipeline(compute_pipeline);
                compute_pass.setBindGroup(0, g_device.createBindGroup({
                    layout: compute_pipeline.getBindGroupLayout(0),
                    entries: [
                            { binding: 0, resource: { buffer: input_buffer, } },
                            { binding: 1, resource: { buffer: vertex_buffer, } },
                            { binding: 2, resource: { buffer: batch_size_buffer, } },
                            { binding: 3, resource: { buffer: transform_buffer, } },
                    ]
                }));

                const workgroup_size = 256; // size declared on the shader
                const num_workgroups = Math.ceil(n_input / workgroup_size);
                compute_pass.dispatchWorkgroups(num_workgroups,1,1);
                compute_pass.end();

                // read output of compute pass
                // const read_buffer = g_device.createBuffer({
                //         size: 6 * 8,
                //         usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
                // });
                // // note that the order is different from writeBuffer 
                // command_encoder.copyBufferToBuffer(
                //         vertex_buffer, // Source buffer
                //         0,             // Source offset
                //         read_buffer,   // Destination buffer
                //         0,             // Destination offset
                //         8 * 6          // Size in bytes
                // );

                // Render Triangle
                const render_pass_descriptor = {
                    colorAttachments: [{
                        view: g_webgpu_context.getCurrentTexture().createView(),
                        loadOp: 'clear',
                        clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                        storeOp: 'store',
                    }],
                };

                const pass_encoder = command_encoder.beginRenderPass(render_pass_descriptor);
                pass_encoder.setPipeline(render_pipeline);
                pass_encoder.setBindGroup(0, g_device.createBindGroup({
                    layout: render_pipeline.getBindGroupLayout(0),
                    entries: [{
                        binding: 0,
                        resource: {
                            buffer: vertex_buffer,
                        }
                    }]
                }));
                pass_encoder.draw(n_vertex); // Fullscreen triangle
                pass_encoder.end();

                g_device.queue.submit([command_encoder.finish()]);
                //}}}


                //{{{
                // await read_buffer.mapAsync(GPUMapMode.READ);
                // const array_buffer = read_buffer.getMappedRange();
                // const output_vertices = new Float32Array(array_buffer);
                // // Each Vertex has two floats (x and y)
                // for (let i = 0; i < output_vertices.length/2; i++) {
                //         console.log(`Vertex ${i}: x=${output_vertices[i * 2]}, y=${output_vertices[i * 2 + 1]}`);
                // }
                // read_buffer.unmap();
                //}}}


        },
        //}}}

        js_set_canvas_size: (width, height) => {
                g_canvas.width  = width;
                g_canvas.height = height;
        },
        js_clear_with_color: (color) => {
                // ctx.fillStyle = parse_color(color);
                // ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        },
        js_fill_rect: (x, y, w, h, color) => {
                // ctx.fillStyle = parse_color(color);
                // ctx.fillRect(x, y, w, h);
        },
        js_fill_circle: (x, y, radius, color) => {
                // ctx.fillStyle = parse_color(color);
                // ctx.beginPath();
                // ctx.arc(x, y, radius, 0, 2*Math.PI);
                // ctx.fill()
        },
        js_draw_texture(x, y, w, h, texture_slot) {
                //{{{
                // const canvas = document.getElementById("canvas");
                // const ctx = canvas.getContext("2d");

                // Define texture dimensions
                // const textureWidth = 4;
                // const textureHeight = 4;

                // // Create image data and fill it with the texture data
                // const imageData = ctx.createImageData(textureWidth, textureHeight);
                // const textureData = createTextureData(textureWidth, textureHeight);
                // imageData.data.set(textureData);

                // // Scale the texture to fit the canvas
                // const rectWidth = canvas.width;
                // const rectHeight = canvas.height;

                // // Draw the texture on the canvas
                // if (texture_slot > 0) {
                //         const texture = textures[texture_slot-1];
                //         const offscreen_canvas = document.createElement("canvas");
                //         offscreen_canvas.width  = w;
                //         offscreen_canvas.height = h;
                //         const offscreen_ctx = offscreen_canvas.getContext("2d");
                //         offscreen_ctx.putImageData(texture, 0, 0);
                //         // texture = textures[texture_slot-1]
                //         // offscreenCtx.putImageData(imageData, x, y);
                //         ctx.drawImage(offscreen_canvas, x, y, w, h);
                // }

                //}}}
        },
        // register callback to update frame
        js_set_update_frame: (f) => {
                // f is a number representing the funciton slot in the function table
                // with wasm64 f is a BigInt
                // update_frame = function_table.get(Number(f));
                wasm_update_frame = g_function_table.get(f);
                console.log(wasm_update_frame);
        },
        // register callback function to push events
        js_set_push_event: (f) => {
                // f is a number representing the funciton slot in the function table
                // with wasm64 f is a BigInt
                // update_frame = function_table.get(Number(f));
                wasm_push_event = g_function_table.get(f);
                console.log(wasm_push_event);
        },
        js_create_texture_rgba: (width, height, pointer, length) => {
                //{{{
                // let texture = ctx.createImageData(width, height);
                // // convert pointer which is a BigInt on wasm64 to a Number
                // let data = get_u8n(pointer,length); 
                // // new Uint8Array(allocated.buffer, Number(pointer), size);
                // texture.data.set(data);
                // texture_slot = textures.push(texture); // index of the texture
                // return texture_slot;
                //}}}
        },
        js_set_malloc: (f) => {
                wasm_malloc = g_function_table.get(f);
                console.log(wasm_malloc);
        },
        js_fetch(fetch_id, url_ptr, url_len, f) {
                const wasm_callback = g_function_table.get(f);
                const url = js_string_from_c_string(url_ptr, url_len);
                fetch_blob_to_wasm(fetch_id, url, wasm_callback);
        },
        // initially we will hardcode the assumptions of the compute
        // pipeline, since we are targeting a rectangle-only 
        // where the rectangle descriptions will be converted
        // to triangles
        js_console_log: (pointer, length) => {
                //{{{
                // const string = js_string_from_jai_string(s_data, s_count);
                const str = js_string_from_c_string(pointer, length);
                console.log(str);
                // write_to_console_log(string, to_standard_error);
                //}}}
        },
        js_wasm_debug_break: () => {
                debugger;
        },
        //}}}
}

// Create the environment for the WASM file,
// which includes the exported JS functions for the WASM:
const imports = {
        "env": new Proxy(exported_js_functions, {
                get(target, prop, receiver) {
                        if (target.hasOwnProperty(prop)) {
                                return target[prop];
                        }
                        return () => { throw new Error("Missing feature: " + prop); };
                },
        }),
}

async function load_wasm_module() {
        //{{{
        const obj = await WebAssembly.instantiateStreaming(fetch("main.wasm"), imports);

        // Shared memory
        g_allocated = obj.instance.exports.memory;

        // Function table
        g_function_table = obj.instance.exports.__indirect_function_table;
        console.log(obj);

        // Canvas
        g_canvas = document.getElementById("gpu-canvas");
        if (!g_canvas) throw new Error("Canvas not found");

        // WebGPU Initialization
        g_gpu_adapter = await navigator.gpu.requestAdapter();
        g_device = await g_gpu_adapter.requestDevice();
        g_format = navigator.gpu.getPreferredCanvasFormat();
        g_webgpu_context = g_canvas.getContext('webgpu');
        g_webgpu_context.configure({
                device: g_device,
                format: g_format,
                alphaMode: 'opaque'
        });


        //{{{ register keyboard event handlers

        // Register the keydown event listener
        document.addEventListener('keydown', (event) => {
                wasm_push_event(0, 0, 0);
                // Capture key details
                // const key = event.key;       // The name of the key
                // const code = event.code;     // The physical key code
                // const isCtrl = event.ctrlKey; // True if Ctrl is pressed
                // const isShift = event.shiftKey; // True if Shift is pressed
                // Display the event details
                // output.textContent = `Key: ${key}, Code: ${code}, Ctrl: ${isCtrl}, Shift: ${isShift}`;
        });

        // Optionally register for keyup event
        document.addEventListener('keyup', () => {
                wasm_push_event(0, 0, 0);
                // output.textContent = 'Key released!';
        });

        //}}}

        //{{{ update frame
        obj.instance.exports.start();
        let prevTimestamp;
        function frame(timestamp) {
                const deltaTime = (timestamp - prevTimestamp)*0.001;
                // console.log(deltaTime);
                prevTimestamp = timestamp;
                // update_frame(BigInt(0), deltaTime);
                wasm_update_frame(deltaTime);
                window.requestAnimationFrame(frame);
        }
        window.requestAnimationFrame((timestamp) => {
                prevTimestamp = timestamp;
                window.requestAnimationFrame(frame);
        });
        //}}}


        console.log("WASM and WebGPU initialized successfully");
        //}}}
}


// Call the async function
load_wasm_module().catch((error) => {
    console.error("Error loading WASM module or initializing WebGPU:", error);
});

// // Load the WASM file we compiled and run its main.
// WebAssembly.instantiateStreaming(fetch("main.wasm"), imports).then(
//         (obj) => {
//                 // shared memory memory
//                 g_allocated = obj.instance.exports.memory;
// 
//                 // function table
//                 g_function_table = obj.instance.exports.__indirect_function_table;
//                 console.log(obj);
// 
//                 // canvas
//                 g_canvas = document.getElementById("gpu-canvas");
//                 if (!g_canvas) throw new Error("Canvas not found");
// 
//                 //{{{ webgpu initialization 
//                 g_gpu_adapter = await navigator.gpu.requestAdapter();
//                 g_device = await g_gpu_adapter.requestDevice();
//                 g_format = navigator.gpu.getPreferredCanvasFormat();
//                 g_webgpu_context = g_canvas.getContext('webgpu');
//                 g_webgpu_context.configure({
//                     device: device,
//                     format: format,
//                     alphaMode: 'opaque'
//                 });
//                 //}}}
// 
//                 //{{{ register keyboard event handlers
// 
//                 // Register the keydown event listener
//                 document.addEventListener('keydown', (event) => {
//                         wasm_push_event(0, 0, 0);
//                         // Capture key details
//                         // const key = event.key;       // The name of the key
//                         // const code = event.code;     // The physical key code
//                         // const isCtrl = event.ctrlKey; // True if Ctrl is pressed
//                         // const isShift = event.shiftKey; // True if Shift is pressed
//                         // Display the event details
//                         // output.textContent = `Key: ${key}, Code: ${code}, Ctrl: ${isCtrl}, Shift: ${isShift}`;
//                 });
// 
//                 // Optionally register for keyup event
//                 document.addEventListener('keyup', () => {
//                         wasm_push_event(0, 0, 0);
//                         // output.textContent = 'Key released!';
//                 });
// 
//                 //}}}
// 
//                 //{{{ update frame
//                 obj.instance.exports.start();
//                 let prevTimestamp;
//                 function frame(timestamp) {
//                         const deltaTime = (timestamp - prevTimestamp)*0.001;
//                         prevTimestamp = timestamp;
//                         // update_frame(BigInt(0), deltaTime);
//                         wasm_update_frame(deltaTime);
//                         window.requestAnimationFrame(frame);
//                 }
//                 window.requestAnimationFrame((timestamp) => {
//                         prevTimestamp = timestamp;
//                         window.requestAnimationFrame(frame);
//                 });
//                 //}}}
//         }
// );
