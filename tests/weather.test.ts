import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formatWeather,getWeather,weatherDate} from '../src/weather.ts';
const now=Date.parse('2026-10-03T07:20:00Z');
const place={name:'宁波',latitude:29.878,longitude:121.55,admin1:'浙江',country:'中国'};
const data={utc_offset_seconds:28800,current:{time:'2026-10-03T15:15',weather_code:3,temperature_2m:24.8,relative_humidity_2m:75,wind_speed_10m:7.9},daily:{time:['2026-10-03','2026-10-04'],weather_code:[81,3],temperature_2m_min:[21,20],temperature_2m_max:[25,26],precipitation_probability_max:[37,80]}};
test('weather separates current estimates from day forecast and rejects stale current values',()=>{
 const result=formatWeather(place,data,'2026-10-03','https://source.test',now);
 assert.equal(result.current?.temperatureC,24.8);assert.equal(result.current?.condition,'阴');
 assert.equal(result.forecast.condition,'中等阵雨');assert.equal(result.forecast.temperatureMinC,21);assert.equal(result.forecast.precipitationProbabilityPercent,37);
 assert.equal(formatWeather(place,data,'2026-10-04','https://source.test',now).current,null);
 const stale={...data,current:{...data.current,time:'2026-10-03T10:00'}};
 assert.equal(formatWeather(place,stale,'2026-10-03','https://source.test',now).current,null);
 assert.throws(()=>formatWeather(place,data,'2026-10-09','https://source.test',now),/没有该日期/);
});
test('weather resolves the city and fetches numeric data with timezone and source attribution',async()=>{
 let calls=0;
 const result=await getWeather('宁波市','今日',(async(url,options)=>{
  calls++;assert.equal(options?.redirect,'manual');
  if(calls===1){assert.ok(String(url).startsWith('https://geocoding-api.open-meteo.com/'));return Response.json({results:[place]});}
  assert.ok(String(url).startsWith('https://api.open-meteo.com/'));assert.ok(String(url).includes('timezone=Asia%2FShanghai'));return Response.json(data);
 })as typeof fetch,now);
 assert.equal(calls,2);assert.equal(result.current?.temperatureC,24.8);assert.equal(result.source.name,'Open-Meteo');
});
test('weather aliases use Beijing dates; missing city/data do not invent weather',async()=>{
 assert.equal(weatherDate('今日',now),'2026-10-03');assert.equal(weatherDate('明日',now),'2026-10-04');assert.equal(weatherDate('后天',now),'2026-10-05');
 assert.throws(()=>weatherDate('2026-02-30',now));
 await assert.rejects(getWeather('不存在','今天',(async()=>Response.json({results:[]}))as typeof fetch,now),/没有找到/);
 await assert.rejects(getWeather('宁波','今天',(async()=>new Response('error',{status:503}))as typeof fetch,now),/暂不可用/);
});
