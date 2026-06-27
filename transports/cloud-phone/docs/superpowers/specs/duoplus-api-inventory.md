# DuoPlus API — Verified Endpoint Inventory

Confirmed from official docs (https://help.duoplus.net/docs/) via live research 2026-06-13.

**Global:** base `https://openapi.duoplus.net` · every endpoint is **POST JSON** · headers `DuoPlus-API-Key: <key>`, `Content-Type: application/json`, `Lang: en` · success envelope `{ "code": 200, "message": "Success", "data": {...} }` (non-200 code = error) · **1 QPS per endpoint** · most batches cap 20 ids (groups cap 100) · phone status codes: 0 not-configured, 1 on, 2 off, 3 expired, 4 renewal-overdue, 10 powering-on, 11 configuring, 12 config-failed.

**Already built (Phase 1 + live wiring):** `cloudPhone/list`, `cloudPhone/powerOn`, `cloudPhone/powerOff`, `cloudPhone/restart`, `cloudPhone/status`.

---

## Cloud Phone — device core

### Details (single)
- `POST /api/v1/cloudPhone/info` — body `{ image_id (req) }`
- data: `{ id, name, remark, os, group:[{id,name}], proxy:{id,dns,ip,country,region,city,zipcode}, gps:{longitude,latitude}, locale:{timezone,language}, sim:{status,country,msisdn,operator,msin,iccid,mcc,mnc}, bluetooth:{name,address}, wifi:{status,name,mac,bssid}, device:{manufacturer,brand,model,imei,serialno,android_id,gsf_id,gaid} }`

### Batch Modify Parameters
- `POST /api/v1/cloudPhone/update` — body `{ images: [{ image_id (req), name?, dpi_name?, remark?, proxy?:{id,dns}, gps?:{type(req),longitude,latitude}, locale?, sim?, bluetooth?, wifi?, device?, station? }] }`
- data: `{ success:[ids], fail:[ids], fail_reason:{id:reason} }` · max 20 · omitted fields unchanged

### Reset & Regenerate
- `POST /api/v1/cloudPhone/newPhone` — body `{ image_id (req), proxy_id?, dns?, model?, gps?:{type(req),longitude,latitude}, locale?, sim?, data_type?(1=reinstall,2/3=clear app data), dpi_name?, network_mode?(1=wifi,2=mobile), keep_gp?(0/1) }`
- data: `{ message:"Success" }` · phone MUST be powered on

### Batch Set Root
- `POST /api/v1/cloudPhone/batchRoot` — body `{ image_ids (req), status (req: 1=enable all,2=disable all,3=enable pkgs,4=disable pkgs), pkgs? (req when status 3/4) }`
- data: `{ success:[ids], fail:[ids], fail_reason:{id:reason} }` · max 20

### Write SMS (inject)
- `POST /api/v1/cloudNumber/imageWriteSms` — body `{ image_id:[ids] (req), sms:[{phone(req),message(req)}] (req) }`
- data: `{ message }` · Android 15 / 12(Region A) only

### Share
- `POST /api/v1/cloudPhone/share` — body `{ share:[{ image_ids (req), config:{ share_status(1/2), share_phone_type(1/2/3), share_code(8-20), share_auth:[1..5] } }] }`
- data: `{ <phoneId>: "share_link" }`

### Change Sharing Password
- `POST /api/v1/cloudPhone/updateSharePassword` — body `{ images:[{ image_id(req), password(req) }] }` · data `{ message:"Success" }`

### Connected Member List
- `POST /api/v1/cloudPhone/linkUserList` — body `{}` · data `{ list:[{user_id, nickname}] }`

### Live Streaming
- `POST /api/v1/cloudPhone/live` — body `{ image_id(req), id?(video file id, req when status=1), status(1=on,2=off), loop(1=on,2=off) }` · data `{ message:"Success" }` · MP4 pushed to /sdcard/DCIM/Camera first

### Scan Code
- `POST /api/v1/cloudPhone/scan` — body `{ image_id(req), id(image file id, req) }` · data `{ message:"Success" }` · Android 12(A)/15 only

## Reference data
- Model List: `POST /api/v1/mobile/modelList` — body `{ os:int(req) }` (1=A10,2=A12RegA,3=A11,4=A15,5=A12RegB,10=A15Pro) · data nested `{ brand:{ model_id:{ name } } }`
- Resource/OS-Region List: `POST /api/v1/cloudPhone/cloudPhone` — body `{}` · data `{ list:[{ name(region), region_id(osId), os, count, used_count }] }`
- Resolution List: `POST /api/v1/cloudPhone/resolutionList` — body `{}` · data `{ list:[ "720x1280(320dpi)", ... ] }`
- Tag List: `POST /api/v1/cloudPhone/tagList` — body `{ name?, page?, pagesize? }` · data `{ list:[{ id, name, color, image_count }] }`

## Buy / Renew
- Buy: `POST /api/v1/cloudPhone/purchase` — body `{ os(req:'10'|'12A'|'11'|'15'|'12B'), duration(req:7/30/90/180/360), quantity(req), coupon_code?, renewal_status?(0/1) }` · data `{ order_id }`
- Renew: `POST /api/v1/cloudPhone/renewal` — body `{ image_ids(req), duration(req), coupon_code? }` · data `{ order_id }`

## ADB / advanced
- Execute ADB: `POST /api/v1/cloudPhone/command` — body `{ image_ids?|image_id?, command(req, no "adb shell" prefix) }` · data multi: `{ "<id>":{success,content,message} }`, single: `{ success,content,message }` · ≤10s commands, ≤20 phones
- Enable ADB: `POST /api/v1/cloudPhone/openAdb` — body `{ image_ids(req) }` · data `{ success:[], fail:[], fail_reason:{} }` · (ADB host/port comes from list endpoint)
- Disable ADB: `POST /api/v1/cloudPhone/closeAdb` — body `{ image_ids(req) }` · data `{ success:[], fail:[], fail_reason:{} }`
- UIAutomator dump: via `cloudPhone/command` with `command:"DuoPlusDumpUI /sdcard/uidump.xml"` (API-only)
- Hide accessibility: via `cloudPhone/command` with `command:"hideAccb pkg1,pkg2"` (API-only, A12/15)

## Proxy
- List: `POST /api/v1/proxy/list` — body `{ page?, pagesize? }` · data `{ list:[{id,name,host,port,user,area}], page,pagesize,total,total_page }`
- Add: `POST /api/v1/proxy/add` — body `{ proxy_list:[{protocol(req,socks5),host(req),port(req),user?,password?,name?}], ip_scan_channel? }` · data `{ success:[{index,id}], fail:[{index,message}] }` · max 20
- Delete: `POST /api/v1/proxy/delete` — body `{ ids(req) }` · data `{ success:[ids], fail:[ids] }`
- Refresh: `POST /api/v1/proxy/refresh` — body `{ ids(req) }` · data `{ success:[ids], fail:[ids] }`
- Modify: `POST /api/v1/proxy/update` — body `{ id(req), host?,port?,user?,password?,name?,ip_scan_channel?,refresh_url?,proxy_url? }` · data `{ message, result:[] }`

## Groups (all under /cloudPhone/)
- List: `POST /api/v1/cloudPhone/groupList` — body `{ page? }` · data `{ list:[{id,name,sort,remark}], page,pagesize,total,total_page }` (pagesize fixed 200)
- Add to group: `POST /api/v1/cloudPhone/addToGroup` — body `{ id(req,groupId), image_ids(req) }` · data `{ message }`
- Move to group: `POST /api/v1/cloudPhone/moveToGroup` — body `{ id(req,groupId), image_ids(req) }` · data `{ message }`
- Create: `POST /api/v1/cloudPhone/createGroup` — body `{ list:[{name(req,2-30),sort?,remark?}] }` · data `{ success:[{index,id,name,sort,remark}], fail:[{index,code,message}] }`
- Edit: `POST /api/v1/cloudPhone/updateGroup` — body `{ list:[{id(req),name(req),sort?,remark?}] }` · data same as create
- Delete: `POST /api/v1/cloudPhone/deleteGroup` — body `{ ids(req) }` · data `{ success:[ids], fail:[ids] }`

## Applications
- Platform list: `POST /api/v1/app/list` — body `{ page?, pagesize? }` · data `{ list:[{id,name,pkg,version_list:[{id,name}]}], page,pagesize,total,total_page }`
- Team list: `POST /api/v1/app/teamList` — same shape
- Install: `POST /api/v1/app/install` — body `{ image_ids(req,≤20), app_id(req), app_version_id? }` · data `{ message }`
- Uninstall: `POST /api/v1/app/uninstall` — body `{ image_ids(req), pkg(req) }` · data `{ message }`
- Installed list: `POST /api/v1/app/installedList` — body `{ image_id(req, SINGULAR) }` · data `{ list:[pkg] }`
- Start: `POST /api/v1/app/start` — body `{ image_ids(req), pkg(req) }` · data `{ message }`
- Close: `POST /api/v1/app/stop` — body `{ image_ids(req), pkg(req) }` · data `{ message }`

## Cloud Drive
- File list: `POST /api/v1/cloudDisk/list` — body `{ keyword?, page?, pagesize? }` · data `{ list:[{id,name,original_file_name}], page,pagesize,total,total_page }`
- Push: `POST /api/v1/cloudDisk/pushFiles` — body `{ ids(req,≤20), image_ids(req,≤20), dest_dir(req) }` · data `{ message, success:[{image_id,id}], fail:[{image_id,id,err}] }`
- Upload (2-step OSS): `POST /api/v1/cloudDisk/signedUrl` — body `{ name(req,with ext), is_app?, pkg? }` · data `{ method:"PUT", signedUrl, headers:{x-oss-callback,x-oss-callback-var}, name, original_file_name }` → then PUT bytes to signedUrl with those headers
- Delete: `POST /api/v1/cloudDisk/delFiles` — body `{ ids(req) }` · data `{ message }`

## Automation
- Custom templates: `POST /api/v1/automation/userTemplateList` — body `{ name?,page?,pagesize? }` · data `{ list:[{id,name,desc}], page,... }`
- Official templates: `POST /api/v1/automation/officialTemplateList` — same shape
- Scheduled task list: `POST /api/v1/automation/taskList` — body `{ issue_at_start(REQ,"Y-m-d H:i:s"), issue_at_end(REQ), id?,status?,template_type?,name?,image_name?,sort_by?,order?,page?,pagesize? }` · data `{ list:[{id,name,task_type_name,image_name,ip,remark,status,issue_at,start_at,finish_at,cost_time,execution_time,created_at}], page,... }`
- Loop task list: `POST /api/v1/automation/planList` — body `{ id?,name?,status?,template_type?,remark?,page?,pagesize? }` · data `{ list:[{id,name,remark,task_type_name,status,created_at}], page,... }`
- Create scheduled: `POST /api/v1/automation/addTask` — body `{ template_id(req),template_type(req),name(req),remark?,images:[{image_id(req),config?,issue_at(req)}] }` · data `{ message }`
- Create loop: `POST /api/v1/automation/addPlan` — body `{ template_id(req),template_type(req),name(req),remark?,images:[{image_id(req),config?,start_at(req),end_at(req),execute_type(req:1=interval,2=daily,3=weekly,4=monthly),gap_time?,execute_time?,execute_end_time?,mode?,weeks?,days?}] }` · data `{ id }`
- Edit loop: `POST /api/v1/automation/savePlan` — body `{ id(req),name?,remark?,images:[...] }` · data `{ id }`
- Pause/Execute loop: `POST /api/v1/automation/setPlanStatus` — body `{ id(req), status(req:0=pause,1=execute) }` · data `{ id }`
- Delete loop: `POST /api/v1/automation/deletePlan` — body `{ id(req) }` · data `{ message }`
- Task report: `POST /api/v1/automation/taskLogList` — body `{ task_id(req), cursor_id? }` · data `{ list:[{id,result_info,start_at,finish_at,created_at}] }` (cursor pagination)
- Cancel/re-exec scheduled: `POST /api/v1/automation/setTaskStatus` — body `{ ids(req), status(req:0=re-exec,5=cancel) }` · data `{ success,fail,fail_reason }`
- Modify publish time: `POST /api/v1/automation/updateTaskTime` — body `{ id(req), issue_at(req) }` · data `{ message }`

## CloudNumber
- List: `POST /api/v1/cloudNumber/numberList` — body `{ phone_number?,status?,type_ids?,region_ids?,renewal_status?,remark?,sort_by?,order?,page?,pagesize? }` · data `{ list:[{id,phone_number,region_name,type_name,status_name,renewal_status,remark,created_at,expired_at}], page,... }`
- SMS: `POST /api/v1/cloudNumber/smsList` — body `{ number_id(req),page?,pagesize? }` · data `{ list:[{message,code,received_at}], page,... }`
- Purchase pkg: `POST /api/v1/cloudNumber/package` — body `{ region(req),type? }` · data `{ duration:[str] }`
- Renewal pkg: `POST /api/v1/cloudNumber/renewalPackage` — body `{ number_ids(req) }` · data `{ numbers:[{id,phone_number,expired_at,duration:[int]}] }`
- Purchase: `POST /api/v1/cloudNumber/purchase` — body `{ region(req),duration(req),type?,quantity?,coupon_code?,renewal_status? }` · data `{ order_id }`
- Renew: `POST /api/v1/cloudNumber/renewal` — body `{ list:[{number_ids(req),duration(req)}] }` · data `{ order_id }`

## Team / Subscription
- Team order list: `POST /api/v1/team/order` — body `{ created_at_start(REQ,ISO8601), created_at_end(REQ), image_ids?,order_id?,status?,type?,product_type?,sort_by?,order?,page?,pagesize?(max 500) }` · data `{ list:[{type,order_id,product,description,status,total,created_at,expired_at,expired_seconds}], page,... }`
- Subscription startup list: `POST /api/v1/subscriptionStartup/list` — body `{ free_status(REQ:0/1), id?,name?,remark?,renewal_status?,sort_by?,order?,page?,pagesize? }` · data `{ list:[{id,name,cpu,ram,rom,renewal_status,free_status,remark,expired_at,created_at,need_renewal}], page,... }`
- Create subscription: `POST /api/v1/subscriptionStartup/purchase` — body `{ duration(req),quantity(req),coupon_code?,renewal_status? }` · data `{ order_id }`
- Renew subscription: `POST /api/v1/subscriptionStartup/renewal` — body `{ phone_ids(req),duration(req),coupon_code? }` · data `{ order_id }`

---

## Build notes
- `os` encoding differs: modelList int codes vs purchase string codes ('12A'/'12B').
- `dpi_name`: resolutionList returns strings; update takes string; newPhone takes int — verify live.
- Timestamp formats vary per endpoint (unix string, "Y-m-d H:i:s", ISO8601) — handle per endpoint.
- taskList and team/order REQUIRE a date range; subscriptionStartup/list REQUIRES free_status.
- Upload is a 2-step Alibaba OSS signed-URL PUT, not multipart.
- UIAutomator dump + hideAccb are not routes — they are special `command` strings.
