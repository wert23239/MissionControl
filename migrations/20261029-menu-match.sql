BEGIN;
CREATE TABLE IF NOT EXISTS public.menu_match_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), neighborhood text NOT NULL, craving text NOT NULL, budget text NOT NULL, notes text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(), restaurant text, address text, reason text, maps_url text
);
ALTER TABLE public.menu_match_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.menu_match_requests FROM anon, authenticated;
CREATE TABLE IF NOT EXISTS public.menu_match_config (id boolean PRIMARY KEY DEFAULT true CHECK(id), key_hash text NOT NULL);
ALTER TABLE public.menu_match_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.menu_match_config FROM anon, authenticated;
CREATE OR REPLACE FUNCTION public.mm_submit(neighborhood text, craving text, budget text, notes text DEFAULT '') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE rid uuid;
BEGIN
 IF neighborhood NOT IN ('Manhattan','Brooklyn','Queens','The Bronx','Staten Island','Anywhere in NYC') OR craving NOT IN ('Comfort food','Something adventurous','Date-night dinner','A casual catch-up','Surprise me') OR budget NOT IN ('Under $25','$25–50','$50–100','$100+') OR neighborhood IS NULL OR craving IS NULL OR budget IS NULL OR length(notes)>600 THEN RAISE EXCEPTION 'Please answer all three questions and keep notes under 600 characters.'; END IF;
 INSERT INTO menu_match_requests(neighborhood,craving,budget,notes) VALUES(neighborhood,craving,budget,coalesce(notes,'')) RETURNING id INTO rid;
 RETURN jsonb_build_object('id',rid);
END $$;
CREATE OR REPLACE FUNCTION public.mm_status(request_id uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('id',id,'neighborhood',neighborhood,'craving',craving,'budget',budget,'restaurant',restaurant,'address',address,'reason',reason,'maps_url',maps_url) FROM menu_match_requests WHERE id=request_id;
$$;
CREATE OR REPLACE FUNCTION public.mm_inbox(access_key text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM menu_match_config WHERE key_hash=encode(sha256(convert_to(access_key,'UTF8')),'hex')) THEN RAISE EXCEPTION 'Curator access key required'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM (SELECT * FROM menu_match_requests ORDER BY created_at DESC LIMIT 200) r);
END $$;
CREATE OR REPLACE FUNCTION public.mm_publish(access_key text, request_id uuid, restaurant text, address text, reason text, maps_url text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM menu_match_config WHERE key_hash=encode(sha256(convert_to(access_key,'UTF8')),'hex')) THEN RAISE EXCEPTION 'Curator access key required'; END IF;
 IF nullif(trim(restaurant),'') IS NULL OR nullif(trim(address),'') IS NULL OR nullif(trim(reason),'') IS NULL OR greatest(length(restaurant),length(address),length(reason))>2000 OR maps_url NOT LIKE 'https://www.google.com/maps/search/?api=1&query=%' THEN RAISE EXCEPTION 'Add a valid restaurant, address and note.'; END IF;
 UPDATE menu_match_requests r SET restaurant=mm_publish.restaurant,address=mm_publish.address,reason=mm_publish.reason,maps_url=mm_publish.maps_url WHERE r.id=request_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
 RETURN '{"ok":true}'::jsonb;
END $$;
REVOKE ALL ON FUNCTION public.mm_submit(text,text,text,text), public.mm_status(uuid), public.mm_inbox(text), public.mm_publish(text,uuid,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_submit(text,text,text,text), public.mm_status(uuid), public.mm_inbox(text), public.mm_publish(text,uuid,text,text,text,text) TO anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
