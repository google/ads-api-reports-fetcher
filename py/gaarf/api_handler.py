# Copyright 2022 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
from typing import Any, Callable, Dict, Optional, Sequence
import re
import operator
from google.ads.googleads.v9.services.types.google_ads_service import GoogleAdsRow  # type: ignore
from google.ads.googleads.v9.services.services.google_ads_service.client import GoogleAdsServiceClient  #type: ignore
from google.ads.googleads.client import GoogleAdsClient  # type: ignore
from . import parsers


def get_customer_ids(service: GoogleAdsServiceClient,
                     customer_id: str) -> Dict[str, str]:
    query_customer_ids = """
    SELECT
        customer_client.descriptive_name,
        customer_client.id,
        customer_client.manager
    FROM customer_client
    """

    response = service.search_stream(customer_id=customer_id,
                                     query=query_customer_ids)
    customer_ids = {}
    for batch in response:
        for row in batch.results:
            if not row.customer_client.manager:
                customer_ids[str(row.customer_client.id
                                 )] = row.customer_client.descriptive_name
    return customer_ids


def parse_ads_row(
        row: GoogleAdsRow, getter: Callable, parser: parsers.BaseParser,
        customizers: Optional[Dict[int, Dict[str, str]]]) -> Sequence[Any]:
    final_rows = []
    for i, r in enumerate(getter(row)):
        if customizers:
            if customizers.get(i):
                caller = customizers.get(i)
                if caller.get("type") == "nested_field":
                    try:
                        r = operator.attrgetter(caller.get("value"))(r)
                    except:
                        raise ValueError(f"{caller} is incorrect")
                elif caller.get("type") == "resource_index":
                    r = re.split("~", r)[caller.get("value")]
        parsed_element = parser.parse(r) or r
        final_rows.append(parsed_element)
    return final_rows