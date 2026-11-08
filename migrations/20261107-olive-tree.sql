BEGIN;
CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;
CREATE TABLE IF NOT EXISTS public.ot_access (id boolean PRIMARY KEY DEFAULT true CHECK(id), key_hash text NOT NULL);
CREATE TABLE IF NOT EXISTS public.ot_members (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), data jsonb NOT NULL, version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS ot_member_email ON public.ot_members (lower(trim(data->>'email'))) WHERE coalesce(trim(data->>'email'),'') <> '';
CREATE TABLE IF NOT EXISTS public.ot_settings (id boolean PRIMARY KEY DEFAULT true CHECK(id), data jsonb NOT NULL, version integer NOT NULL DEFAULT 1);
INSERT INTO public.ot_settings(id,data) VALUES(true,'{"levels":["Unassessed","Beginning","Developing","Experienced","Professional"],"types":["Fiction","Nonfiction","Poetry","Memoir","Essays","Blogging","Screenwriting"],"lumaFormUrl":""}') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.ot_luma (id boolean PRIMARY KEY DEFAULT true CHECK(id), tokens jsonb, state_hash text, verifier text, started_at timestamptz, connected_at timestamptz);
ALTER TABLE public.ot_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ot_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ot_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ot_luma ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ot_access,public.ot_members,public.ot_settings,public.ot_luma FROM anon,authenticated;
CREATE OR REPLACE FUNCTION public.ot_check(access_key text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ot_access WHERE key_hash=encode(sha256(convert_to(access_key,'UTF8')),'hex')) THEN RAISE EXCEPTION 'Access key not recognized'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.ot_read(access_key text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
BEGIN
 PERFORM ot_check(access_key);
 RETURN jsonb_build_object('members',(SELECT coalesce(jsonb_agg(data||jsonb_build_object('id',id,'version',version,'updatedAt',updated_at) ORDER BY lower(data->>'name')),'[]'::jsonb) FROM ot_members),'settings',(SELECT data||jsonb_build_object('version',version) FROM ot_settings WHERE id),'luma',jsonb_build_object('connected',EXISTS(SELECT 1 FROM ot_luma WHERE tokens->>'access_token' IS NOT NULL),'connectedAt',(SELECT connected_at FROM ot_luma WHERE id)));
END $$;
CREATE OR REPLACE FUNCTION public.ot_save_member(access_key text, member jsonb, expected_version integer DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE r ot_members; mid uuid; clean jsonb;
BEGIN
 PERFORM ot_check(access_key);
 IF jsonb_typeof(member) <> 'object' OR nullif(trim(member->>'name'),'') IS NULL OR length(member::text)>150000 OR length(member->>'name')>200 THEN RAISE EXCEPTION 'Name required; member record too large or invalid'; END IF;
 IF coalesce(member->>'email','') <> '' AND member->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'Email address is invalid'; END IF;
 IF jsonb_typeof(member->'types') IS DISTINCT FROM 'array' OR jsonb_typeof(member->'sources') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Types and sources must be lists'; END IF;
 clean = (member-'id'-'version'-'updatedAt') || jsonb_build_object('name',trim(member->>'name'),'email',lower(trim(coalesce(member->>'email',''))));
 IF expected_version=0 THEN
  INSERT INTO ot_members(data) VALUES(clean) RETURNING * INTO r;
 ELSE
  mid=(member->>'id')::uuid;
  UPDATE ot_members SET data=clean,version=version+1,updated_at=now() WHERE id=mid AND version=expected_version RETURNING * INTO r;
  IF NOT FOUND THEN RAISE EXCEPTION 'This member changed in another tab. Reload and try again.'; END IF;
 END IF;
 RETURN r.data||jsonb_build_object('id',r.id,'version',r.version,'updatedAt',r.updated_at);
END $$;
CREATE OR REPLACE FUNCTION public.ot_save_settings(access_key text, settings jsonb, expected_version integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE r ot_settings;
BEGIN
 PERFORM ot_check(access_key);
 IF jsonb_typeof(settings->'levels') IS DISTINCT FROM 'array' OR jsonb_typeof(settings->'types') IS DISTINCT FROM 'array' OR jsonb_array_length(settings->'levels')<1 OR length(settings::text)>20000 THEN RAISE EXCEPTION 'Add at least one level; settings too large or invalid'; END IF;
 UPDATE ot_settings SET data=settings-'version',version=version+1 WHERE id AND version=expected_version RETURNING * INTO r;
 IF NOT FOUND THEN RAISE EXCEPTION 'Settings changed in another tab. Reload first.'; END IF;
 RETURN r.data||jsonb_build_object('version',r.version);
END $$;
CREATE OR REPLACE FUNCTION public.ot_luma_begin(access_key text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE v text=encode(gen_random_bytes(32),'hex'); s text=encode(gen_random_bytes(24),'hex');
BEGIN
 PERFORM ot_check(access_key);
 INSERT INTO ot_luma(id,state_hash,verifier,started_at) VALUES(true,encode(sha256(convert_to(s,'UTF8')),'hex'),v,now()) ON CONFLICT(id) DO UPDATE SET state_hash=excluded.state_hash,verifier=v,started_at=now();
 RETURN jsonb_build_object('state',s,'challenge',rtrim(translate(encode(sha256(convert_to(v,'UTF8')),'base64'),'+/','-_'),'='),'client_id','https://wert23239.github.io/MissionControl/community/oauth-client.json','redirect_uri','https://wert23239.github.io/MissionControl/community/','authorization_endpoint','https://luma.com/oauth/consent?credential_type=personal');
END $$;
CREATE OR REPLACE FUNCTION public.ot_luma_finish(access_key text, state text, code text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE c ot_luma; resp extensions.http_response; tok jsonb;
BEGIN
 PERFORM ot_check(access_key);
 SELECT * INTO c FROM ot_luma WHERE id FOR UPDATE;
 IF c.started_at<now()-interval '10 minutes' OR c.state_hash IS NULL OR c.state_hash <> encode(sha256(convert_to(state,'UTF8')),'hex') THEN RAISE EXCEPTION 'Sign-in expired or state mismatch. Connect Luma again.'; END IF;
 PERFORM set_config('http.curlopt_timeout_msec','15000',true);
 SELECT * INTO resp FROM extensions.http(('POST','https://api.luma.com/oauth/token',ARRAY[extensions.http_header('Accept','application/json')],'application/x-www-form-urlencoded','grant_type=authorization_code&client_id='||extensions.urlencode('https://wert23239.github.io/MissionControl/community/oauth-client.json')||'&redirect_uri='||extensions.urlencode('https://wert23239.github.io/MissionControl/community/')||'&code_verifier='||c.verifier||'&code='||extensions.urlencode(code))::extensions.http_request);
 IF resp.status<>200 THEN RAISE EXCEPTION 'Luma did not accept sign-in (HTTP %). Reconnect and try again.',resp.status; END IF;
 tok=resp.content::jsonb;
 IF nullif(tok->>'access_token','') IS NULL THEN RAISE EXCEPTION 'Luma returned no access token'; END IF;
 UPDATE ot_luma SET tokens=tok||jsonb_build_object('expires_at',extract(epoch from now())+coalesce((tok->>'expires_in')::integer,3600)),connected_at=now(),state_hash=NULL,verifier=NULL,started_at=NULL WHERE id;
 RETURN '{"connected":true}'::jsonb;
END $$;
CREATE OR REPLACE FUNCTION public.ot_luma_disconnect(access_key text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
BEGIN
 PERFORM ot_check(access_key);
 DELETE FROM ot_luma;
 RETURN '{"connected":false}'::jsonb;
END $$;
CREATE OR REPLACE FUNCTION public.ot_luma_rpc(access_key text, method text, params jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE c ot_luma; resp extensions.http_response; tok jsonb; headers extensions.http_header[]; result jsonb; line text; toolname text;
BEGIN
 PERFORM ot_check(access_key);
 IF method NOT IN ('initialize','notifications/initialized','tools/list','tools/call') THEN RAISE EXCEPTION 'Unsupported Luma read operation'; END IF;
 IF method='tools/call' THEN
  toolname=lower(params->>'name');
  IF toolname IS NULL OR toolname !~ '(list|search|get|fetch)' OR toolname !~ '(event|guest|calendar|contact|registration)' OR toolname ~ '(create|update|delete|remove|cancel|send|approve|reject|refund|add|import)' THEN RAISE EXCEPTION 'Only event and guest read tools are allowed'; END IF;
 END IF;
 IF length(params::text)>20000 THEN RAISE EXCEPTION 'Luma request too large'; END IF;
 SELECT * INTO c FROM ot_luma WHERE id FOR UPDATE;
 IF c.tokens->>'access_token' IS NULL THEN RAISE EXCEPTION 'Connect Luma first'; END IF;
 PERFORM set_config('http.curlopt_timeout_msec','18000',true);
 IF (c.tokens->>'expires_at')::numeric < extract(epoch from now())+30 THEN
  IF c.tokens->>'refresh_token' IS NULL THEN RAISE EXCEPTION 'Luma session expired. Reconnect Luma.'; END IF;
  SELECT * INTO resp FROM extensions.http(('POST','https://api.luma.com/oauth/token',NULL,'application/x-www-form-urlencoded','grant_type=refresh_token&client_id='||extensions.urlencode('https://wert23239.github.io/MissionControl/community/oauth-client.json')||'&refresh_token='||extensions.urlencode(c.tokens->>'refresh_token'))::extensions.http_request);
  IF resp.status<>200 THEN RAISE EXCEPTION 'Luma session expired. Reconnect Luma.'; END IF;
  tok=resp.content::jsonb;
  c.tokens=c.tokens||tok||jsonb_build_object('expires_at',extract(epoch from now())+coalesce((tok->>'expires_in')::integer,3600));
  UPDATE ot_luma SET tokens=c.tokens WHERE id;
 END IF;
 headers=ARRAY[extensions.http_header('Authorization','Bearer '||(c.tokens->>'access_token')),extensions.http_header('Accept','application/json, text/event-stream'),extensions.http_header('MCP-Protocol-Version',coalesce(c.tokens->>'mcp_protocol','2025-03-26'))];
 IF c.tokens->>'mcp_session' IS NOT NULL AND method<>'initialize' THEN headers=array_append(headers,extensions.http_header('Mcp-Session-Id',c.tokens->>'mcp_session')); END IF;
 SELECT * INTO resp FROM extensions.http(('POST','https://mcp.luma.com',headers,'application/json',(jsonb_build_object('jsonrpc','2.0','method',method,'params',params)||CASE WHEN method='notifications/initialized' THEN '{}'::jsonb ELSE '{"id":1}'::jsonb END)::text)::extensions.http_request);
 IF resp.status NOT BETWEEN 200 AND 299 THEN RAISE EXCEPTION 'Luma request failed (HTTP %). Reconnect if expired.',resp.status; END IF;
 IF method='notifications/initialized' THEN RETURN '{}'::jsonb; END IF;
 IF length(resp.content)>5000000 THEN RAISE EXCEPTION 'Luma response too large. Use a smaller page.'; END IF;
 IF resp.content ~ '^\s*\{' THEN result=resp.content::jsonb; ELSE
  FOR line IN SELECT unnest(string_to_array(resp.content,E'\n')) LOOP
   IF line LIKE 'data: %' THEN result=substring(line from 7)::jsonb; IF result ? 'result' OR result ? 'error' THEN EXIT; END IF; END IF;
  END LOOP;
 END IF;
 IF result IS NULL THEN RAISE EXCEPTION 'Luma returned an unreadable response'; END IF;
 IF result ? 'error' THEN RAISE EXCEPTION 'Luma: %',left(result->'error'->>'message',300); END IF;
 IF method='initialize' THEN
  IF result->'result'->>'protocolVersion' IS NOT NULL THEN UPDATE ot_luma SET tokens=jsonb_set(tokens,'{mcp_protocol}',result->'result'->'protocolVersion') WHERE id; END IF;
  SELECT h.value INTO line FROM unnest(resp.headers) h WHERE lower(h.field)='mcp-session-id' LIMIT 1;
  IF line IS NOT NULL THEN UPDATE ot_luma SET tokens=jsonb_set(tokens,'{mcp_session}',to_jsonb(line)) WHERE id; END IF;
 END IF;
 RETURN result->'result';
END $$;
REVOKE ALL ON FUNCTION public.ot_check(text),public.ot_read(text),public.ot_save_member(text,jsonb,integer),public.ot_save_settings(text,jsonb,integer),public.ot_luma_begin(text),public.ot_luma_finish(text,text,text),public.ot_luma_disconnect(text),public.ot_luma_rpc(text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ot_read(text),public.ot_save_member(text,jsonb,integer),public.ot_save_settings(text,jsonb,integer),public.ot_luma_begin(text),public.ot_luma_finish(text,text,text),public.ot_luma_disconnect(text),public.ot_luma_rpc(text,text,jsonb) TO anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
CREATE OR REPLACE FUNCTION public.ot_import_members(access_key text, members jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE m jsonb; result jsonb='[]'::jsonb;
BEGIN
 PERFORM ot_check(access_key);
 IF jsonb_typeof(members) IS DISTINCT FROM 'array' OR jsonb_array_length(members)>500 OR length(members::text)>10000000 THEN RAISE EXCEPTION 'Import at most 500 members / 10 MB at a time'; END IF;
 FOR m IN SELECT jsonb_array_elements(members) LOOP
  result=result||jsonb_build_array(ot_save_member(access_key,m,coalesce((m->>'version')::integer,0)));
 END LOOP;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.ot_import_members(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ot_import_members(text,jsonb) TO anon,authenticated;
NOTIFY pgrst,'reload schema';
