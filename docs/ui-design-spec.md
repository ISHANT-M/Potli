# Potli UI design spec

## Partner signup: store entrance pin

- Ask for the exact store entrance while collecting business details. Finding a street or landmark moves the map without selecting a point. Partners can tap, drag the pin, use the map centre (keyboard accessible), or share their current location.
- The pin is required for new signups. Manual latitude/longitude entry is available if the map cannot load or is difficult to use. Address and city remain editable and required even if reverse lookup fails.
- The browser keeps an account-bound draft through email verification. If the verification link opens in another browser or the draft is missing, let the verified applicant fill in the business details without registering again.
- The saved coordinates and address prefill the first new listing after partner approval. Partners can adjust them before publishing. No store appears in customer results simply from signup or approval: discovery still uses active listings from approved partners. Existing partners without a saved pin can continue placing one on the listing form.

## Maps and degraded states

- Customer search, listing details and partner maps share an OpenFreeMap basemap, independent of Potli's listing pins. Keep provider attribution visible.
- If the basemap fails, show a short inline warning. Customer search keeps its list usable, listing details keep the directions link, and partners can enter exact coordinates manually.
- Keep signup map actions stacked on small screens, with labels, a focused validation message, and editable address fields below the picker.
