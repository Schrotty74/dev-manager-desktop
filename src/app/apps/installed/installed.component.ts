import {Component, Host, Input, OnDestroy, ChangeDetectionStrategy} from '@angular/core';
import {AppsComponent} from '../apps.component';
import {Device, PackageInfo} from "../../types";
import {Observable, Subscription} from "rxjs";
import {AppsRepoService, RepositoryItem} from "../../core/services";
import {CatalogIndexService} from '../../core/services/catalog-index.service';

@Component({
    selector: 'app-installed',
    templateUrl: './installed.component.html',
    styleUrls: ['./installed.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class InstalledComponent implements OnDestroy {

    @Input()
    device: Device | null = null;

    installedError?: Error;

    repoPackages?: Record<string, RepositoryItem>;

    private subscription?: Subscription;
    private generation = 0;
    private installedField?: Observable<PackageInfo[] | null>;

    constructor(@Host() public parent: AppsComponent, private appsRepo: AppsRepoService, public catalogs: CatalogIndexService) {
    }

    @Input()
    set installed$(value: Observable<PackageInfo[] | null> | undefined) {
        this.subscription?.unsubscribe();
        this.repoPackages = undefined;
        const generation = ++this.generation;
        this.subscription = value?.subscribe({
            next: (pkgs) => {
                this.installedError = undefined;

                const strings: string[] = pkgs?.map((pkg) => pkg.id) ?? [];
                this.appsRepo.showApps(...strings).then(apps => {
                    if (generation === this.generation) this.repoPackages = apps;
                });
                for (const source of this.catalogs.sources.sources()) {
                    if (!source.builtIn) void this.catalogs.refresh(source, false);
                }
            },
            error: (error) => {
                console.log('installed apps', error);
                return this.installedError = error;
            }
        });
        this.installedField = value;
    }

    get installed$(): Observable<PackageInfo[] | null> | undefined {
        return this.installedField;
    }

    ngOnDestroy(): void {
        this.generation++;
        this.subscription?.unsubscribe();
    }

    customUpdates(pkg: PackageInfo) {
        return this.catalogs.candidates(pkg.id).filter(candidate => !candidate.source.builtIn &&
            candidate.item.manifest?.hasUpdate(pkg.version) === true);
    }

    refreshUpdates(): void {
        this.loadPackages();
        void this.catalogs.refreshAll();
    }

    loadPackages(): void {
        this.installedError = undefined;
        this.parent.loadPackages();
    }
}
