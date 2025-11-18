import time
import os
import io
import math
import json
import requests
from flask import Flask, request, send_from_directory, jsonify
from flask_cors import CORS
from PIL import Image, ImageDraw, ImageFont
import torch
from ultralytics import YOLO
import numpy as np
from dotenv import load_dotenv
from openai import OpenAI
import cv2  # 使用 cv2.boxPoints 取得旋轉矩形的頂點

# 從 .env 文件中載入環境變數
load_dotenv()

# 初始化 Flask 應用程式
app = Flask(__name__)
CORS(app)

# 載入 YOLO11n OBB 模型（取代原本的 YOLOv8 模型）
model = YOLO('yolov8n.pt')  # 舊版 YOLOv8 模型範例
# model = YOLO('yolo11n-obb.pt')  # 使用 OBB 權重模型
# model = YOLO('yolo11x-obb.pt')  # 使用 OBB 權重模型

# 檢查是否有可用的 CUDA 並將模型移動到 GPU
if torch.cuda.is_available():
    model.to('cuda')
    print("使用 CUDA 進行推理")
else:
    print("未啟用 CUDA，使用 CPU")

# 設定 OpenAI API 金鑰
client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

# 從環境變數中讀取 Google Places API 金鑰
GOOGLE_PLACES_API_KEY = os.environ.get("GOOGLE_PLACES_API_KEY")

# --------------------- 與地理位置相關的函式 ---------------------
def get_location_coordinates(place_name):
    url = "https://maps.googleapis.com/maps/api/place/findplacefromtext/json"
    params = {
        "input": place_name,
        "inputtype": "textquery",
        "fields": "geometry",
        "key": GOOGLE_PLACES_API_KEY
    }
    response = requests.get(url, params=params)
    data = response.json()
    if data.get("candidates"):
        location = data["candidates"][0]["geometry"]["location"]
        return {"latitude": location["lat"], "longitude": location["lng"]}
    else:
        return None

def get_multiple_locations(place_names):
    features = []
    for name in place_names:
        coordinates = get_location_coordinates(name)
        if coordinates:
            feature = {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [coordinates["longitude"], coordinates["latitude"]]
                },
                "properties": {
                    "name": name
                }
            }
            features.append(feature)
    if features:
        return {
            "type": "FeatureCollection",
            "features": features
        }
    else:
        return None

def 建立_buffer_polygon(lon, lat, radius_km, num_points=64):
    points = []
    for i in range(num_points):
        angle = 2 * math.pi * i / num_points
        delta_lat = (radius_km / 111.32) * math.sin(angle)
        denom = 111.32 * math.cos(math.radians(lat))
        delta_lon = (radius_km / denom) * math.cos(angle) if abs(denom) >= 1e-6 else 0
        points.append([lon + delta_lon, lat + delta_lat])
    points.append(points[0])
    return points

def get_buffer_polygon(place_name, radius_km):
    """
    取得以指定地點為中心且半徑為 radius_km 公里的圓形（buffer），
    同時回傳中心點位置，最終回傳的 GeoJSON 包含兩個 feature:
      - type 為 "Polygon" 的 buffer 圓
      - type 為 "Point" 的中心點
    """
    center = get_location_coordinates(place_name)
    if not center:
        return None
    lon = center["longitude"]
    lat = center["latitude"]
    polygon = 建立_buffer_polygon(lon, lat, radius_km)
    features = []
    polygon_feature = {
        "type": "Feature",
        "geometry": {
            "type": "Polygon",
            "coordinates": [polygon]
        },
        "properties": {
            "name": place_name,
            "radius_km": radius_km,
            "feature_type": "buffer"
        }
    }
    point_feature = {
        "type": "Feature",
        "geometry": {
            "type": "Point",
            "coordinates": [lon, lat]
        },
        "properties": {
            "name": place_name,
            "feature_type": "center"
        }
    }
    features.append(polygon_feature)
    features.append(point_feature)
    geojson = {
        "type": "FeatureCollection",
        "features": features
    }
    return geojson

def get_multiple_buffer_polygons(locations):
    """
    參數 locations 為列表，每個項目格式例如：
      {"place_name": "三芝雷達站", "radius_km": 10}
    回傳的 GeoJSON 會包含每個地點的 buffer 圓以及中心點資訊
    """
    features = []
    for loc in locations:
        coordinates = get_location_coordinates(loc["place_name"])
        if coordinates:
            lon = coordinates["longitude"]
            lat = coordinates["latitude"]
            polygon = 建立_buffer_polygon(lon, lat, loc["radius_km"])
            polygon_feature = {
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [polygon]
                },
                "properties": {
                    "name": loc["place_name"],
                    "radius_km": loc["radius_km"],
                    "feature_type": "buffer"
                }
            }
            point_feature = {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [lon, lat]
                },
                "properties": {
                    "name": loc["place_name"],
                    "feature_type": "center"
                }
            }
            features.append(polygon_feature)
            features.append(point_feature)
    if features:
        return {
            "type": "FeatureCollection",
            "features": features
        }
    else:
        return None


### NEW ###  多點→Polygon
def get_polygon_from_coordinates(coordinates):
    """
    依序將多個 {'latitude': xx, 'longitude': xx} 連線成 GeoJSON Polygon。
    至少需 3 點；未滿 3 點回傳 None。
    """
    if not isinstance(coordinates, list) or len(coordinates) < 3:
        return None

    # 轉成 [lon, lat]，並將首點加入末端閉合
    ring = [[pt["longitude"], pt["latitude"]] for pt in coordinates]
    ring.append(ring[0])

    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [ring]},
                "properties": {"feature_type": "polygon_from_points"}
            }
        ]
    }


# --------------------- 結束地理位置相關的函式 ---------------------

# 定義靜態文件的目錄路徑
FOLDER_PATH = os.path.join(os.getcwd(), 'static')

@app.route('/')
def serve_index():
    return send_from_directory('static', 'index.html')

@app.route('/<path:filename>')
def serve_file(filename):
    return send_from_directory(FOLDER_PATH, filename)

def split_image_into_tiles(image, tile_size, overlap):
    width, height = image.size
    tiles = []
    for top in range(0, height, tile_size - overlap):
        for left in range(0, width, tile_size - overlap):
            right = min(left + tile_size, width)
            bottom = min(top + tile_size, height)
            box = (left, top, right, bottom)
            tile = image.crop(box)
            tiles.append((tile, left, top))
    return tiles

# 針對 yolo11n-obb.pt 的 OBB 偵測功能
# def run_yolo11n_obb_on_batch_tiles(model, tiles, draw, font):
#     # 將 PIL 影像轉為 numpy 陣列，建立批次輸入
#     batch = [np.array(tile.convert('RGB')) for tile, _, _ in tiles]
#     results = model(batch)
#     bboxes = []
#     for i, (tile, left, top) in enumerate(tiles):
#         result = results[i]
#         # 檢查 OBB 資訊是否存在
#         if result.obb is None:
#             continue
#         # 假設 OBB 格式為 [中心點_x, 中心點_y, 寬度, 高度, 角度, 信心度, 類別編號]
#         obb_data = result.obb.data.cpu().numpy()
#         for obb in obb_data:
#             cx, cy, w, h, angle, conf, cls = obb
#             angle_deg = angle * 180.0 / math.pi  # 轉換為角度
#             # 將 tile 偏移量轉為全域座標
#             cx_global = cx + left
#             cy_global = cy + top
#             rect = ((cx_global, cy_global), (w, h), angle_deg)
#             box = cv2.boxPoints(rect)
#             box = np.intp(box)
#             draw.polygon(list(map(tuple, box)), outline="red")
#             x_text, y_text = int(np.min(box[:, 0])), int(np.min(box[:, 1]))
#             class_id = int(cls)
#             class_name = model.names[class_id] if model.names is not None else str(class_id)
#             draw.text((x_text, y_text - 10), class_name, font=font, fill="red")
#             bboxes.append({
#                 "class_name": class_name,
#                 "class_id": int(class_id),
#                 "obb": [
#                     float(cx_global),
#                     float(cy_global),
#                     float(w),
#                     float(h),
#                     float(angle),
#                     float(conf)
#                 ]
#             })
#     return bboxes
def run_yolo11n_obb_on_batch_tiles(model, tiles, draw, font, allowed_classes=None):
    # 定義預設顏色清單（若類別數超過清單數量，會重複循環）
    colors = ['yellow','red', 'blue', 'green', 'magenta', 'cyan', 'orange', 'purple']
    # 建立類別對應顏色的字典
    class_color_map = {}
    
    # 將 PIL 影像轉為 numpy 陣列，建立批次輸入
    batch = [np.array(tile.convert('RGB')) for tile, _, _ in tiles]
    results = model(batch)
    bboxes = []
    for i, (tile, left, top) in enumerate(tiles):
        result = results[i]
        # 檢查 OBB 資訊是否存在
        if result.obb is None:
            continue
        # 假設 OBB 格式為 [中心點_x, 中心點_y, 寬度, 高度, 角度, 信心度, 類別編號]
        obb_data = result.obb.data.cpu().numpy()
        for obb in obb_data:
            cx, cy, w, h, angle, conf, cls = obb
            class_id = int(cls)
            class_name = model.names[class_id] if model.names is not None else str(class_id)
            # 若指定了 allowed_classes，僅處理符合條件的類別
            if allowed_classes is not None and class_name not in allowed_classes:
                continue

            angle_deg = angle * 180.0 / math.pi  # 轉換為角度
            # 將 tile 偏移量轉為全域座標
            cx_global = cx + left
            cy_global = cy + top
            rect = ((cx_global, cy_global), (w, h), angle_deg)
            box = cv2.boxPoints(rect)
            box = np.intp(box)
            
            # 依照類別決定顏色，若尚未建立對應則從 colors 清單中依序指派
            if class_name not in class_color_map:
                class_color_map[class_name] = colors[len(class_color_map) % len(colors)]
            color = class_color_map[class_name]
            
            # 使用 draw.line 畫出較粗的偵測框（設定線寬為 3）
            points = list(map(tuple, box))
            draw.line(points + [points[0]], fill=color, width=3)
            
            x_text, y_text = int(np.min(box[:, 0])), int(np.min(box[:, 1]))
            draw.text((x_text, y_text - 10), class_name, font=font, fill=color)
            bboxes.append({
                "class_name": class_name,
                "class_id": class_id,
                "obb": [
                    float(cx_global),
                    float(cy_global),
                    float(w),
                    float(h),
                    float(angle),
                    float(conf)
                ]
            })
    return bboxes



@app.route('/analyze', methods=['POST'])
def analyze_image():
    image_file = request.files['image']
    image = Image.open(image_file)
    width, height = image.size
    image = image.convert('RGB')
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default()
    tile_size = 1024
    overlap = 0
    tiles = split_image_into_tiles(image, tile_size, overlap)
    # bboxes = run_yolo11n_obb_on_batch_tiles(model, tiles, draw, font)
    bboxes = run_yolo11n_obb_on_batch_tiles(model, tiles, draw, font, allowed_classes=["plane", "ship", "storage tank", "helicopter"])

    img_io = io.BytesIO()
    image.save(img_io, 'JPEG')
    img_io.seek(0)
    processed_image_path = os.path.join(FOLDER_PATH, 'processed_image.jpg')
    image.save(processed_image_path)
    timestamp = int(time.time())
    return {
        "bboxes": bboxes,
        "image_size": {"width": width, "height": height},
        "image_path": f"/static/processed_image.jpg?t={timestamp}"
    }

@app.route('/generate', methods=['POST'])
def generate_text():
    try:
        data = request.get_json()
        user_message = data.get('prompt', '')
        if not user_message:
            return jsonify({'error': '訊息為必填'}), 400

        messages = [
            {
                "role": "system",
                "content": '''
你是個情報分析師，會使用繁體中文回覆。
回覆時，若回答內容中有地名、地區名稱或景點，請分為兩部分回覆：
1. 第一部分請完整回答使用者問題；
2. 第二部分將所有地名及其經緯度座標以 GeoJSON 格式回傳，
   若僅查詢單一地點，請回傳 Point；若有多個地點，請以 FeatureCollection 形式回傳。
（中略：這裡保留你原本的說明與範例，不用改，只是我省略）
'''
            },
        ]
        messages.append({"role": "user", "content": user_message})

        # ✅ 使用新版 tools，而不是舊的 functions
        tools = [
            {
                "type": "function",
                "function": {
                    "name": "get_location_coordinates",
                    "description": "取得單一指定地名的經緯度",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "place_name": {
                                "type": "string",
                                "description": "例如 '台北101'"
                            }
                        },
                        "required": ["place_name"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "get_buffer_polygon",
                    "description": "取得以指定地名為中心，並以指定半徑（公里）劃出的 buffer 圓（GeoJSON 格式），同時回傳中心點",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "place_name": {
                                "type": "string",
                                "description": "例如 '台北101'"
                            },
                            "radius_km": {
                                "type": "number",
                                "description": "例如 2"
                            }
                        },
                        "required": ["place_name", "radius_km"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "get_multiple_locations",
                    "description": "取得多個地名的經緯度，並以 GeoJSON 陣列格式回傳",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "place_names": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": "例如 ['台北101', '淡水老街']"
                            }
                        },
                        "required": ["place_names"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "get_multiple_buffer_polygons",
                    "description": "取得多個地名，以各自指定半徑劃出 buffer 圓（GeoJSON 格式），並同時回傳中心點",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "locations": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "place_name": {"type": "string", "description": "例如 '三芝雷達站'"},
                                        "radius_km": {"type": "number", "description": "例如 10"}
                                    },
                                    "required": ["place_name", "radius_km"]
                                },
                                "description": "例如 [{'place_name': '三芝雷達站', 'radius_km': 10}, {'place_name': '淡水漁人碼頭', 'radius_km': 10}]"
                            }
                        },
                        "required": ["locations"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "get_polygon_from_coordinates",
                    "description": "將多個經緯度點依順序連線為 GeoJSON Polygon",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "coordinates": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "latitude":  {"type": "number"},
                                        "longitude": {"type": "number"}
                                    },
                                    "required": ["latitude", "longitude"]
                                },
                                "description": "按照連線順序排列的座標列表"
                            }
                        },
                        "required": ["coordinates"]
                    }
                }
            }
        ]

        # ✅ 新版呼叫方式：client.chat.completions.create
        response = client.chat.completions.create(
            model="gpt-4.1-mini",
            messages=messages,
            tools=tools,
            tool_choice="auto"
        )

        response_message = response.choices[0].message  # 物件，不是 dict

        # ✅ 新版工具呼叫：tool_calls，而不是 function_call
        if getattr(response_message, "tool_calls", None):
            tool_call = response_message.tool_calls[0]
            function_name = tool_call.function.name
            try:
                arguments = json.loads(tool_call.function.arguments)
            except Exception as ex:
                return jsonify({'error': '解析函式參數失敗: ' + str(ex)}), 500

            # ===== 以下邏輯沿用你原本的分支，只是改用 function_name / arguments =====

            if function_name == "get_multiple_buffer_polygons":
                try:
                    locations = arguments["locations"]
                    if not isinstance(locations, list):
                        return jsonify({'error': 'locations 應為列表'}), 400
                except Exception as ex:
                    return jsonify({'error': '解析 locations 失敗: ' + str(ex)}), 500

                geojson = get_multiple_buffer_polygons(locations)
                if geojson:
                    answer_text = "以下為各地點對應的圓形範圍及中心點："
                else:
                    answer_text = "找不到任何有效的地點資訊。"
                final_reply = (
                    f"{answer_text}\n\n"
                    "geojson ```\n"
                    f"{json.dumps(geojson, ensure_ascii=False, indent=2)}\n"
                    "```"
                )
                return jsonify({'response': final_reply}), 200

            elif function_name == "get_multiple_locations":
                try:
                    place_names = arguments["place_names"]
                    if not isinstance(place_names, list):
                        return jsonify({'error': 'place_names 應為列表'}), 400
                except Exception as ex:
                    return jsonify({'error': '解析 place_names 失敗: ' + str(ex)}), 500

                geojson = get_multiple_locations(place_names)
                if geojson:
                    answer_text = f"您提到的地點分別為：{', '.join(place_names)}。以下為詳細資訊："
                else:
                    answer_text = "找不到任何地點資訊。"
                final_reply = (
                    f"{answer_text}\n\n"
                    "geojson ```\n"
                    f"{json.dumps(geojson, ensure_ascii=False, indent=2)}\n"
                    "```"
                )
                return jsonify({'response': final_reply}), 200

            elif function_name == "get_buffer_polygon":
                try:
                    radius = float(arguments["radius_km"])
                except Exception as ex:
                    return jsonify({'error': '半徑參數錯誤: ' + str(ex)}), 400

                geojson = get_buffer_polygon(arguments["place_name"], radius)
                if geojson:
                    answer_text = f"以 {arguments['place_name']} 為中心、半徑 {radius} 公里的範圍及中心點如下："
                else:
                    answer_text = f"找不到 {arguments['place_name']} 的相關資訊。"
                final_reply = (
                    f"{answer_text}\n\n"
                    "geojson ```\n"
                    f"{json.dumps(geojson, ensure_ascii=False, indent=2)}\n"
                    "```"
                )
                return jsonify({'response': final_reply}), 200

            elif function_name == "get_location_coordinates":
                coordinates = get_location_coordinates(arguments["place_name"])
                if coordinates:
                    answer_text = f"地點：{arguments['place_name']}，經緯度：{coordinates}。"
                    geojson_point = {
                        "type": "FeatureCollection",
                        "features": [
                            {
                                "type": "Feature",
                                "geometry": {
                                    "type": "Point",
                                    "coordinates": [coordinates["longitude"], coordinates["latitude"]]
                                },
                                "properties": {
                                    "name": arguments["place_name"]
                                }
                            }
                        ]
                    }
                    final_reply = (
                        f"{answer_text}\n\n"
                        "geojson ```\n"
                        f"{json.dumps(geojson_point, ensure_ascii=False, indent=2)}\n"
                        "```"
                    )
                else:
                    final_reply = f"找不到 {arguments['place_name']} 的相關資訊。"
                return jsonify({'response': final_reply}), 200

            elif function_name == "get_polygon_from_coordinates":
                try:
                    coords = arguments["coordinates"]
                    if not isinstance(coords, list):
                        return jsonify({'error': 'coordinates 應為列表'}), 400
                except Exception as ex:
                    return jsonify({'error': '解析 coordinates 失敗: ' + str(ex)}), 500

                geojson = get_polygon_from_coordinates(coords)
                if geojson:
                    final_reply = (
                        "已依序連線下列座標並形成多邊形：\n\n"
                        "geojson ```\n"
                        f"{json.dumps(geojson, ensure_ascii=False, indent=2)}\n"
                        "```"
                    )
                else:
                    final_reply = "座標數量不足，無法形成多邊形。"
                return jsonify({'response': final_reply}), 200

        else:
            # ✅ 注意：新版 message 是物件，要用 .content
            return jsonify({'response': response_message.content}), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=80)
