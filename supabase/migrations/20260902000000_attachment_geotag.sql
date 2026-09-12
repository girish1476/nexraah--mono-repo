-- The geo-stamped selfie (BR-23) stored no geo.
--
-- Both upload paths collected coordinates and neither kept them: the
-- transporter portal validated that a selfie carried latitude/longitude and
-- then discarded both (`portal-profile.service.ts`), and the console's
-- `POST /attachments` ignored the parts entirely. "Geo-stamped selfie at the
-- yard" is a mandatory KYC item precisely so Compliance can check where the
-- photo was taken — which was impossible, on either path, for every selfie
-- collected so far.
--
-- The columns live on `attachments` because that is the one table both paths
-- already write; rows uploaded before this migration stay null, which is the
-- honest answer for them. Same precision as `telematics_pings.lat/lng`.

alter table attachments add column geo_lat numeric(9,6);
alter table attachments add column geo_lng numeric(9,6);

-- Half a coordinate proves presence nowhere — both or neither.
alter table attachments add constraint attachments_geo_pair
  check ((geo_lat is null) = (geo_lng is null));

alter table attachments add constraint attachments_geo_range
  check (geo_lat is null
      or (geo_lat between -90 and 90 and geo_lng between -180 and 180));
