-- The company row was seeded (`20260814090400`) with a made-up company — a
-- Nashik address and a Maharashtra GST number — and every invoice and lorry
-- receipt printed it. This puts the real one in its place: the name, the
-- Gajuwaka address (kept as the lines it is written in), the GST number and the
-- PAN that number carries. The made-up CIN goes with the made-up company.
--
-- Guarded on the made-up GST number, so a row somebody has already corrected
-- from Admin -> Control panel is left exactly as they typed it, and running
-- this twice changes nothing. The bank line is replaced only where it is still
-- the seeded one.
update config
set value = value
      || jsonb_build_object(
           'name', 'NEXUS FREIGHT PRIVATE LIMITED',
           'gstin', '37AAKCN9322K1ZY',
           'pan', 'AAKCN9322K',
           'cin', '',
           'address', E'9-1-128, Ganesh Nagar, Revenue Ward 64, Gajuwaka\nVisakhapatnam, Andhra Pradesh\n530026'
         )
      || case
           when value ->> 'bank' = 'HDFC Bank · Nashik · A/c 50200044714471 · IFSC HDFC0000188'
             then jsonb_build_object('bank', 'Account No: 256303933846 · IFSC Code: INDB0000081')
           else '{}'::jsonb
         end,
    updated_at = now()
where key = 'company'
  and value ->> 'gstin' = '27AABCN4471K1ZV';
