import { SearchView } from "@/components/search/search-view";
import { requestCountry } from "@/lib/server/itunes";
export default function SearchPage() {
  return <SearchView defaultCountry={requestCountry(null)} />;
}
