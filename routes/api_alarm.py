from flask import Blueprint, request, jsonify
from sqlalchemy import Column, Integer, String, Text, DateTime
from datetime import datetime
from config import make_engine_and_session
import json, os

api_alarm = Blueprint("api_alarm", __name__)

# === 初始化資料庫 ===
# 使用「這個檔案」的相對路徑，確保無論在哪執行都能正確找到資料庫
db_path = os.path.join(os.path.dirname(__file__), "../db/alarm_zones.db")
engine, Session, Base = make_engine_and_session(db_path)


class AlarmZone(Base):
    __tablename__ = "alarm_zones"
    id = Column(Integer, primary_key=True)
    name = Column(String(100))
    geojson = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)


Base.metadata.create_all(engine)



# === 儲存警戒範圍 API ===
@api_alarm.route("/api/save_alarm_zones", methods=["POST"])
def save_alarm_zones():
    try:
        data = request.get_json()
        if not data or data.get("type") != "FeatureCollection":
            return "Invalid GeoJSON format", 400

        session = Session()
        for f in data["features"]:
            name = f["properties"].get("name", "未命名")
            geojson_str = json.dumps(f, ensure_ascii=False)
            session.add(AlarmZone(name=name, geojson=geojson_str))
        session.commit()
        session.close()
        return jsonify({"status": "success"}), 200
    except Exception as e:
        print("❌ 儲存警戒區錯誤:", e)
        return str(e), 500

# === 取得所有警戒區 ===
@api_alarm.route("/api/get_alarm_zones", methods=["GET"])
def get_alarm_zones():
    session = Session()
    zones = session.query(AlarmZone).all()
    data = []
    for z in zones:
        try:
            f = json.loads(z.geojson)
            f["properties"]["id"] = z.id
            data.append(f)
        except Exception:
            continue
    session.close()
    return jsonify({"type": "FeatureCollection", "features": data}), 200


# === 刪除指定警戒區 ===
@api_alarm.route("/api/delete_alarm_zone/<int:zone_id>", methods=["DELETE"])
def delete_alarm_zone(zone_id):
    session = Session()
    zone = session.query(AlarmZone).filter_by(id=zone_id).first()
    if not zone:
        session.close()
        return jsonify({"error": "not found"}), 404
    session.delete(zone)
    session.commit()
    session.close()
    return jsonify({"status": "deleted"}), 200
