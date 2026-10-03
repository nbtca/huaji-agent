type Place = { name: string; latitude: number; longitude: number; admin1?: string; country?: string; country_code?: string };
const codes: Record<number,string>={0:'晴',1:'大致晴朗',2:'局部多云',3:'阴',45:'雾',48:'霜雾',51:'小毛毛雨',53:'中等毛毛雨',55:'浓毛毛雨',56:'小冻毛毛雨',57:'浓冻毛毛雨',61:'小雨',63:'中雨',65:'大雨',66:'小冻雨',67:'大冻雨',71:'小雪',73:'中雪',75:'大雪',77:'雪粒',80:'小阵雨',81:'中等阵雨',82:'强阵雨',85:'小阵雪',86:'强阵雪',95:'雷暴',96:'雷暴伴冰雹',99:'强雷暴伴冰雹'};
export const weatherDescription=(code:number)=>codes[code]??'天气代码 '+code;
const beijingDate=(time:number)=>new Date(time+8*3600000).toISOString().slice(0,10);
export function weatherDate(value:string,now:number):string {
  const offsets:Record<string,number>={今天:0,今日:0,明天:1,明日:1,后天:2,后日:2,昨天:-1,昨日:-1};
  if(value in offsets)return beijingDate(now+offsets[value]*86400000);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw new Error('日期格式应为今天、明天或YYYY-MM-DD');
  return value;
}
function number(value:unknown):number {if(typeof value!=='number'||!Number.isFinite(value))throw new Error('天气源缺少有效数值');return value;}
export function formatWeather(place:Place,data:any,date:string,source:string,now:number) {
  const index=data.daily?.time?.indexOf(date)??-1;
  if(index<0)throw new Error('天气源没有该日期数据');
  const forecast={date,condition:weatherDescription(number(data.daily.weather_code[index])),temperatureMinC:number(data.daily.temperature_2m_min[index]),temperatureMaxC:number(data.daily.temperature_2m_max[index]),
    precipitationProbabilityPercent:typeof data.daily.precipitation_probability_max?.[index]==='number'?data.daily.precipitation_probability_max[index]:null};
  let current=null;
  if(date===beijingDate(now)&&data.current) {
    const time=Date.parse(data.current.time+'Z')-number(data.utc_offset_seconds)*1000;
    if(Number.isFinite(time)&&now-time<=90*60000&&time-now<=15*60000)current={time:data.current.time,timezone:'Asia/Shanghai',condition:weatherDescription(number(data.current.weather_code)),temperatureC:number(data.current.temperature_2m),humidityPercent:number(data.current.relative_humidity_2m),windSpeedKmh:number(data.current.wind_speed_10m)};
  }
  return {location:{name:place.name,region:place.admin1,country:place.country,latitude:place.latitude,longitude:place.longitude},retrievedAt:new Date(now).toISOString(),timezone:'Asia/Shanghai',current,forecast,
    source:{name:'Open-Meteo',url:source,documentation:'https://open-meteo.com/en/docs'},
    note:'近时天气为模型估计，日数据为预报或近期历史模型数据，不是气象站实测。current为空时不要编造当前气温；必须按forecast.date回答。'};
}
export async function getWeather(city:string,dateValue='今天',request:typeof fetch=fetch,now=Date.now()) {
  if(typeof city!=='string'||!city.trim()||city.length>64)throw new Error('城市名长度应为1至64字');
  const date=weatherDate(dateValue,now);
  const geoUrl='https://geocoding-api.open-meteo.com/v1/search?name='+encodeURIComponent(city.trim().replace(/市$/,''))+'&count=5&language=zh&format=json';
  const geo=await request(geoUrl,{redirect:'manual',signal:AbortSignal.timeout(12000)});
  if(!geo.ok)throw new Error('城市检索暂不可用');
  const places=(await geo.json() as {results?:Place[]}).results;
  const place=places?.find(p=>p.name.replace(/市$/,'')===city.trim().replace(/市$/,''))??places?.[0];
  if(!place||!Number.isFinite(place.latitude)||!Number.isFinite(place.longitude))throw new Error('没有找到该城市，请补充省份或国家');
  const url='https://api.open-meteo.com/v1/forecast?'+new URLSearchParams({latitude:String(place.latitude),longitude:String(place.longitude),current:'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m',daily:'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',timezone:'Asia/Shanghai',forecast_days:'3',past_days:'2',temperature_unit:'celsius',wind_speed_unit:'kmh'});
  const response=await request(url,{redirect:'manual',signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new Error('天气数据源暂不可用');
  return formatWeather(place,await response.json(),date,url,now);
}
